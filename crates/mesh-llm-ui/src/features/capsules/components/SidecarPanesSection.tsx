// The "Panes" section of the Accountability tab ([mesh-live-tab-pane-proxy]
// build item 2): renders the sidecar's own `/accountability/pane-a|b|c`
// derivations (rung grading, peer grouping, the nine-property assurance
// map) alongside this node's raw capsule ledger. Q2 ruling: the sidecar
// URL is ONE config field, learned here, never a mesh-llm host route; when
// it is unset this section shows only the config affordance -- no fetch is
// attempted, no spinner, no error banner. Everything here is a property
// recomputed from artifacts, never a score: `content_binding` and
// `producer_signature` are recomputed in this browser and shown as such --
// the sidecar's own chip for those two properties is never trusted or
// displayed, per the design's non-negotiable rule.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusPill, type StatusPillTone } from '@/components/ui/status-pill'
import { TooltipProvider } from '@/components/ui/tooltip'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { fetchPaneA, fetchPaneB, fetchPaneCList } from '@/features/capsules/api/sidecarClient'
import { useSidecarBaseUrl } from '@/features/capsules/api/sidecarConfig'
import type { PaneARow, PaneBRow, PaneCRow, PaneState } from '@/features/capsules/api/sidecarTypes'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import { useRecomputedIdentity } from '@/features/capsules/lib/recompute-identity'

const RECOMPUTED_PROPERTIES = new Set(['content_binding', 'producer_signature'])

function boolToTone(value: boolean | null): StatusPillTone {
  return value === null ? 'neutral' : value ? 'good' : 'bad'
}

function boolToState(value: boolean | null): string {
  return value === null ? 'NOT_CHECKED' : value ? 'PASS' : 'FAIL'
}

function StateChip({ label, cell }: { label: string; cell: PaneState }) {
  return (
    <StatusPill
      label={`${label}: ${cell.state}`}
      tone={toneForState(cell.state)}
      tooltip={typeof cell.text === 'string' ? cell.text : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Sidecar URL config -- the one field, hides everything below when unset.
// ---------------------------------------------------------------------------

function SidecarUrlField() {
  const { baseUrl, setBaseUrl, clearBaseUrl } = useSidecarBaseUrl()
  const [draft, setDraft] = useState(baseUrl ?? '')

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <label htmlFor="sidecar-base-url" className="type-label text-fg-faint">
        Sidecar URL
      </label>
      <input
        id="sidecar-base-url"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="http://127.0.0.1:8765"
        className="min-w-[220px] flex-1 rounded-md border border-border/70 bg-card px-2 py-1 text-sm text-foreground"
      />
      <button
        type="button"
        onClick={() => setBaseUrl(draft)}
        disabled={draft.trim().length === 0}
        className="rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-foreground hover:bg-card disabled:opacity-50"
      >
        Save
      </button>
      {baseUrl ? (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            clearBaseUrl()
          }}
          className="rounded-md border border-border/70 px-2 py-1 text-xs font-medium text-fg-dim hover:bg-card"
        >
          Clear
        </button>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pane A -- "This node" rows, from build_pane_a_json
// ---------------------------------------------------------------------------

function PaneARowView({ row, nodePubKeyPem }: { row: PaneARow; nodePubKeyPem: string | null }) {
  const identity = useRecomputedIdentity(row.record, nodePubKeyPem)
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-fg-dim">{row.capsule_id.slice(0, 16)}…</span>
        <StatusPill
          label={`content binding: ${boolToState(identity.idMatch)}`}
          tone={boolToTone(identity.idMatch)}
          tooltip="recomputed in this browser from the full record -- never trusted from the payload"
        />
        <StatusPill
          label={`producer signature: ${boolToState(identity.signatureOk)}`}
          tone={boolToTone(identity.signatureOk)}
          tooltip="recomputed in this browser against the detached signed statement -- never trusted from the payload"
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(row.rungs).map(([key, value]) => (
          <StateChip key={key} label={key.replace(/_/g, ' ')} cell={value} />
        ))}
      </div>
    </div>
  )
}

function PaneASection({ baseUrl, nodePubKeyPem }: { baseUrl: string; nodePubKeyPem: string | null }) {
  const query = useQuery({
    queryKey: ['sidecar', 'pane-a', baseUrl],
    queryFn: () => fetchPaneA(baseUrl),
    refetchInterval: 15_000,
    retry: false
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>My node (sidecar)</CardTitle>
        <p className="type-body mt-1 max-w-[68ch] text-fg-dim">
          Every row's content binding and producer signature are recomputed here, not taken from the sidecar.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {query.isError ? (
          <p className="text-sm text-amber-500">
            Sidecar unreachable ({query.error instanceof Error ? query.error.message : 'unknown error'}).
          </p>
        ) : null}
        {query.data && query.data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No capsules on this node's ledger yet.</p>
        ) : null}
        {query.data?.rows.map((row) => (
          <PaneARowView key={row.capsule_id} row={row} nodePubKeyPem={nodePubKeyPem} />
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pane B -- "Peers" rows, from build_pane_b_json. Peer-aggregate cells are
// rendered verbatim (tone-mapped) -- there is no single record to recompute
// a content-binding/signature chip against for a cross-exchange summary row.
// ---------------------------------------------------------------------------

function PaneBRowView({ row }: { row: PaneBRow }) {
  const cells: Array<[string, PaneState]> = [
    ['node', row.node],
    ['rung', row.rung],
    ['history (theirs)', row.history],
    ['served (theirs)', row.served],
    ['verdicts', row.verdicts]
  ]
  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-2 last:border-0">
      <div className="text-sm font-medium text-foreground">{row.peer_id}</div>
      <div className="flex flex-wrap gap-1.5">
        {cells.map(([label, cell]) => (
          <StateChip key={label} label={label} cell={cell} />
        ))}
      </div>
    </div>
  )
}

function PaneBSection({ baseUrl }: { baseUrl: string }) {
  const query = useQuery({
    queryKey: ['sidecar', 'pane-b', baseUrl],
    queryFn: () => fetchPaneB(baseUrl),
    refetchInterval: 15_000,
    retry: false
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Peers (sidecar)</CardTitle>
        <p className="type-body mt-1 max-w-[68ch] text-fg-dim">
          What have the nodes this one has dealt with shown it — grouped from this node's own ledger only.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {query.isError ? (
          <p className="text-sm text-amber-500">
            Sidecar unreachable ({query.error instanceof Error ? query.error.message : 'unknown error'}).
          </p>
        ) : null}
        {query.data && query.data.peer_count === 0 ? (
          <p className="text-sm text-muted-foreground">No peer exchanges recorded yet.</p>
        ) : null}
        {query.data?.rows.map((row) => (
          <PaneBRowView key={row.peer_id} row={row} />
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Pane C -- "This exchange" rows, from build_exchange_list_payload. Carries
// the nine-property assurance map; content_binding/producer_signature are
// recomputed against this node's own raw ledger record when the row's
// `mine` half names a capsule_id this node actually sealed -- a
// counterparty-only half has no local record to recompute against and
// renders NOT_CHECKED, honestly, rather than trusting the sidecar's chip.
// ---------------------------------------------------------------------------

function PaneCRowView({
  row,
  recordsById,
  nodePubKeyPem
}: {
  row: PaneCRow
  recordsById: Map<string, CapsuleRecord>
  nodePubKeyPem: string | null
}) {
  const localRecord = row.mine.capsule_id ? (recordsById.get(row.mine.capsule_id) ?? null) : null
  const identity = useRecomputedIdentity(localRecord, nodePubKeyPem)
  const properties = row.properties ?? {}

  return (
    <div className="flex flex-col gap-1.5 border-b border-border/60 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{row.exchange_key}</span>
        <StatusPill label={row.role_tag} tone="neutral" />
        {row.has_issue ? <StatusPill label="issue" tone="bad" /> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(properties).map(([key, value]) => {
          if (!RECOMPUTED_PROPERTIES.has(key))
            return <StateChip key={key} label={key.replace(/_/g, ' ')} cell={value} />
          const recomputed = key === 'content_binding' ? identity.idMatch : identity.signatureOk
          return (
            <StatusPill
              key={key}
              label={`${key.replace(/_/g, ' ')}: ${boolToState(recomputed)} (recomputed)`}
              tone={boolToTone(recomputed)}
              tooltip="recomputed in this browser, not trusted from the sidecar payload"
            />
          )
        })}
      </div>
    </div>
  )
}

function PaneCSection({
  baseUrl,
  recordsById,
  nodePubKeyPem
}: {
  baseUrl: string
  recordsById: Map<string, CapsuleRecord>
  nodePubKeyPem: string | null
}) {
  const query = useQuery({
    queryKey: ['sidecar', 'pane-c', baseUrl],
    queryFn: () => fetchPaneCList(baseUrl),
    refetchInterval: 15_000,
    retry: false
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Exchanges (sidecar)</CardTitle>
        <p className="type-body mt-1 max-w-[68ch] text-fg-dim">
          Grouped by exchange, capped/paginated by the sidecar; content binding and producer signature are always
          recomputed here.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        {query.isError ? (
          <p className="text-sm text-amber-500">
            Sidecar unreachable ({query.error instanceof Error ? query.error.message : 'unknown error'}).
          </p>
        ) : null}
        {query.data && query.data.row_count === 0 ? (
          <p className="text-sm text-muted-foreground">No exchanges recorded yet.</p>
        ) : null}
        {query.data?.rows.map((row) => (
          <PaneCRowView key={row.exchange_key} row={row} recordsById={recordsById} nodePubKeyPem={nodePubKeyPem} />
        ))}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section entry point
// ---------------------------------------------------------------------------

export function SidecarPanesSection() {
  const { baseUrl } = useSidecarBaseUrl()

  // Fetched once here (not per-pane) so Pane A/C's client-side recompute
  // share this node's own public key and raw ledger records rather than
  // each pane re-fetching the same ledger independently.
  const ledgerQuery = useQuery({
    queryKey: ['capsules', 'ledger'],
    queryFn: fetchCapsuleLedger,
    enabled: baseUrl !== null,
    refetchInterval: 15_000
  })

  const recordsById = useMemo(() => {
    const map = new Map<string, CapsuleRecord>()
    for (const record of ledgerQuery.data?.records ?? []) {
      if (record.capsule_id) map.set(record.capsule_id, record)
    }
    return map
  }, [ledgerQuery.data])

  return (
    // TooltipProvider is required by the StatusPill chip tooltips rendered
    // inside the pane sections. There is no global provider in the app shell,
    // so we scope one here (same pattern as DisabledControlFrame).
    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
      <section className="mx-auto max-w-3xl">
        <div className="mb-4">
          <div className="type-label text-fg-faint">Accountability</div>
          <h1 className="type-display mt-1 text-foreground">Panes</h1>
          <p className="type-body mt-2 max-w-[68ch] text-fg-dim">
            Reads the capsule-emit-mesh sidecar's own accountability routes directly — never through this app's own
            backend. Set the sidecar's URL to enable; leave it blank to keep this section off.
          </p>
          <SidecarUrlField />
        </div>

        {baseUrl === null ? (
          <p className="text-sm text-muted-foreground">
            No sidecar URL configured — the Panes views stay off until one is set above.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <PaneASection baseUrl={baseUrl} nodePubKeyPem={ledgerQuery.data?.nodePubKeyPem ?? null} />
            <PaneBSection baseUrl={baseUrl} />
            <PaneCSection
              baseUrl={baseUrl}
              recordsById={recordsById}
              nodePubKeyPem={ledgerQuery.data?.nodePubKeyPem ?? null}
            />
          </div>
        )}
      </section>
    </TooltipProvider>
  )
}
