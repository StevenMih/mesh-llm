// [mesh-live-tab-pane-proxy] L3/L4, [mesh-ledger-earned-pass-and-native-panes]
// Part B: Ledger tab — four sections (Balance / Peers / Exchanges /
// Integrity) replacing the prior four sub-tabs. Data comes from this host's
// own `/api/capsules/panes/*` route, which forwards server-side to the
// capsule-emit-mesh sidecar -- the user never configures anything; honest
// absent states where data is unavailable.
//
// Security boundary: NO user-visible strings may name internal tooling,
// internal item IDs, or any branded service name. Comments are exempt.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoBanner } from '@/components/ui/InfoBanner'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StatusPill } from '@/components/ui/status-pill'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabPanel } from '@/components/ui/TabPanel'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { PaneFetchError, fetchPaneA, fetchPaneB, fetchPaneCList } from '@/features/capsules/api/sidecarClient'
import type { PaneARow, PaneBRow, PaneCRow, PaneState } from '@/features/capsules/api/sidecarTypes'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import { useRecomputedIdentity } from '@/features/capsules/lib/recompute-identity'

// ---------------------------------------------------------------------------
// Error helper — honest fetch-failure messages, never "set the URL"
// ---------------------------------------------------------------------------

/** Returns a user-visible diagnostic string for a failed pane fetch. Never
 *  blames the user for missing configuration -- there is none to set. */
function describePaneError(error: unknown): string {
  if (error instanceof PaneFetchError && error.status === 503) {
    return "The host's capsule service isn't running."
  }
  return "Couldn't load accountability data from this host right now."
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type LedgerTab = 'balance' | 'peers' | 'exchanges' | 'integrity'

// The nine properties from the spec §2 — verbatim order
const NINE_PROPERTY_LABELS: Record<string, string> = {
  content_binding: 'content binding',
  producer_signature: 'producer signature',
  local_inclusion: 'local inclusion',
  checkpoint_signature: 'checkpoint signature',
  external_registration: 'external registration',
  continuity: 'continuity',
  identity_authority: 'identity/authority',
  capture_coverage: 'capture coverage',
  outcome_corroboration: 'outcome corroboration'
}

// These two are ALWAYS recomputed in-browser — never trusted from sidecar.
const RECOMPUTED_PROPERTIES = new Set(['content_binding', 'producer_signature'])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function boolToTone(value: boolean | null) {
  return value === null ? ('neutral' as const) : value ? ('good' as const) : ('bad' as const)
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
// L3.5 — Declare the break dialog
// ---------------------------------------------------------------------------

type DeclareBreakDialogProps = {
  onConfirm: (cause: string) => void
  onCancel: () => void
}

function DeclareBreakDialog({ onConfirm, onCancel }: DeclareBreakDialogProps) {
  const [cause, setCause] = useState('unknown')

  return (
    <div className="mt-2 rounded border border-border/60 bg-card p-3 text-xs text-fg-dim">
      <p className="mb-2 font-medium text-foreground">Declaring this break has two consequences:</p>
      <ol className="mb-3 ml-3 flex list-decimal flex-col gap-1">
        <li>This exchange will be marked as broken in your local record.</li>
        <li>Other nodes you exchange with will be able to see that you declared a break here.</li>
      </ol>
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="declare-cause" className="shrink-0">
          Cause:
        </label>
        <select
          id="declare-cause"
          value={cause}
          onChange={(e) => setCause(e.target.value)}
          className="rounded border border-border/70 bg-card px-1 py-0.5 text-xs text-foreground"
        >
          <option value="restored_from_backup">Restored from backup</option>
          <option value="reinstalled">Reinstalled</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onConfirm(cause)}
          className="rounded border border-border/60 px-2 py-0.5 text-xs text-foreground hover:bg-card"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// L4 — Owner identity types
// ---------------------------------------------------------------------------

type OwnerStatus = {
  binding: 'absent' | 'bound' | 'invalid'
  expiry?: string | null
  owner_id?: string | null
}

// ---------------------------------------------------------------------------
// LedgerCard — single card component for every section
//
// Anatomy (L3.3 updated order):
//   1. Headline (L3.1)
//   2. Promise line
//   3. Recorded facts / advertised vs served
//   4. Retained status
//   5. Disclosure link
//   6. "Show the security checks" expander (chips in trigger + verbatim checklist)
//   7. Adjudications
//   8. Actions (§5 vocabulary for FAIL states, L3.5)
// ---------------------------------------------------------------------------

type LedgerCardProps = {
  // Minimal required identity fields
  exchangeId: string
  timestamp: string | null
  // The nine-property chip strip — each key is one of the NINE_PROPERTY_LABELS keys
  // For recomputed props (content_binding, producer_signature), pass the recomputed
  // identity values; for others, pass the PaneState from the sidecar.
  chipStates: Partial<Record<string, PaneState>>
  // Recomputed properties override chipStates for the two identity props
  recomputedIdMatch: boolean | null
  recomputedSignatureOk: boolean | null
  // Optional extra rows
  modelInfo?: string | null
  promiseState?: string | null
  retainedMine?: string | null
  retainedTheirs?: string | null
  disclosureLabel?: string | null
  adjudicationCount?: number
  // For the security checklist expander
  fullCapsuleId?: string | null
  // L3.1 — headline text for this card
  headline?: string | null
  // L3.6 — unanswered exchange state
  unanswered?: boolean
  unansweredDate?: string | null
  seenOnlineSince?: string | null
  // L4.1 — owner identity
  ownerStatus?: OwnerStatus | null
}

function LedgerCard({
  exchangeId,
  timestamp,
  chipStates,
  recomputedIdMatch,
  recomputedSignatureOk,
  modelInfo,
  promiseState,
  retainedMine,
  retainedTheirs,
  disclosureLabel,
  adjudicationCount,
  fullCapsuleId,
  headline,
  unanswered,
  unansweredDate,
  seenOnlineSince,
  ownerStatus
}: LedgerCardProps) {
  const [showDeclareDialog, setShowDeclareDialog] = useState(false)
  const failedProps = Object.entries(chipStates)
    .filter(([, cell]) => cell?.state === 'FAIL')
    .map(([key]) => key)

  // Build the ordered nine-property chip list
  const orderedChips = Object.keys(NINE_PROPERTY_LABELS).map((propKey) => {
    const label = NINE_PROPERTY_LABELS[propKey] ?? propKey.replace(/_/g, ' ')
    if (propKey === 'content_binding') {
      return {
        propKey,
        label,
        tone: boolToTone(recomputedIdMatch),
        state: boolToState(recomputedIdMatch),
        recomputed: true
      }
    }
    if (propKey === 'producer_signature') {
      return {
        propKey,
        label,
        tone: boolToTone(recomputedSignatureOk),
        state: boolToState(recomputedSignatureOk),
        recomputed: true
      }
    }
    // L4.1 — identity/authority chip: always NOT_PRESENT for authority sub-fact
    if (propKey === 'identity_authority') {
      const cell = chipStates[propKey]
      // The binding fact determines the chip state; authority is always NOT_PRESENT
      let state = 'NOT_PRESENT'
      if (ownerStatus) {
        state = ownerStatus.binding === 'bound' ? 'PASS' : ownerStatus.binding === 'invalid' ? 'FAIL' : 'NOT_PRESENT'
      } else if (cell?.state) {
        state = cell.state
      }
      return { propKey, label, tone: toneForState(state), state, recomputed: false }
    }
    const cell = chipStates[propKey]
    const state = cell?.state ?? 'NOT_CHECKED'
    return { propKey, label, tone: toneForState(state), state, recomputed: false }
  })

  // L3.2 — Card title: model · short-exchange-id · timestamp
  function formatTimestamp(ts: string | null): string | null {
    if (!ts) return null
    // Extract time portion if it's an ISO timestamp
    const match = ts.match(/T(\d{2}:\d{2}:\d{2})Z?/)
    if (match) return `${match[1]}Z`
    return ts
  }

  const shortId = exchangeId.slice(0, 8)
  const timeDisplay = formatTimestamp(timestamp)
  const cardTitle = modelInfo
    ? [modelInfo, shortId, timeDisplay].filter(Boolean).join(' · ')
    : [shortId, timeDisplay].filter(Boolean).join(' · ')

  // L4.1 — owner identity text
  function ownerLine(): string | null {
    if (!ownerStatus) return null
    if (ownerStatus.binding === 'bound') {
      const expiryText = ownerStatus.expiry ? `valid to ${ownerStatus.expiry}` : 'self-asserted'
      return `Owner: bound (self-asserted, ${expiryText}) — not bound to a person.`
    }
    if (ownerStatus.binding === 'invalid') {
      return 'Owner: binding invalid — not bound to a person.'
    }
    return 'Owner: not present — not bound to a person.'
  }

  const ownerText = ownerLine()

  return (
    <Card className="mb-3">
      <CardHeader className="pb-2">
        {/* L3.2 — Card title: model · short-id · timestamp */}
        <CardTitle className="text-sm font-mono text-fg-dim">{cardTitle}</CardTitle>
        {fullCapsuleId && fullCapsuleId !== exchangeId ? (
          <p className="text-xs text-fg-faint font-mono">{fullCapsuleId.slice(0, 24)}…</p>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3 pt-0">
        {/* L3.1 — Headline */}
        {headline ? <p className="text-xs text-fg-dim">{headline}</p> : null}

        {/* L3.6 — Unanswered exchange state (never in FAIL, never red) */}
        {unanswered ? (
          <p className="text-xs text-fg-dim">
            {unansweredDate ? `Asked ${unansweredDate}, no reply.` : 'Asked, no reply.'} Seen online since:{' '}
            {seenOnlineSince ?? 'no.'}
          </p>
        ) : null}

        {/* L4.1 — Owner identity */}
        {ownerText ? <p className="text-xs text-fg-dim">{ownerText}</p> : null}

        {/* 2. Promise line */}
        {promiseState ? (
          <p className="text-xs text-fg-dim">
            <span className="font-medium">Promise: </span>
            {promiseState}
          </p>
        ) : null}

        {/* 4. Retained */}
        {(retainedMine ?? retainedTheirs) ? (
          <div className="text-xs text-fg-dim">
            {retainedMine ? <div>Mine: {retainedMine}</div> : null}
            {retainedTheirs ? <div>Theirs: {retainedTheirs}</div> : null}
          </div>
        ) : null}

        {/* 5. Disclosure */}
        {disclosureLabel ? (
          <p className="text-xs">
            <span className="text-fg-faint">Disclosure: </span>
            <span className="text-fg-dim">{disclosureLabel}</span>
          </p>
        ) : null}

        {/* 6. Security checks expander — L3.3: chips in the trigger header */}
        <Accordion type="single" collapsible>
          <AccordionItem value="security-checks">
            <AccordionTrigger className="text-xs text-fg-dim flex-wrap gap-1.5">
              {/* L3.3: chip strip is now the trigger header */}
              <span className="flex flex-wrap gap-1 mr-2">
                {orderedChips.map(({ propKey, label, tone, state, recomputed }) => (
                  <StatusPill
                    key={propKey}
                    label={recomputed ? `${label}: ${state} (recomputed)` : `${label}: ${state}`}
                    tone={tone}
                    tooltip={
                      recomputed
                        ? 'recomputed in this browser — not taken from the data source'
                        : (chipStates[propKey]?.text ?? undefined)
                    }
                  />
                ))}
              </span>
              <span className="shrink-0">Show the security checks</span>
            </AccordionTrigger>
            <AccordionContent>
              <ol className="ml-2 flex flex-col gap-1 text-xs text-fg-dim">
                <li>
                  <span className="font-mono">capsule_id</span>
                  {fullCapsuleId ? (
                    <span className="ml-1 font-mono text-fg-faint">{fullCapsuleId.slice(0, 24)}…</span>
                  ) : null}
                </li>
                <li>recomputed in-browser</li>
                <li>
                  id matches: <StatusPill label={boolToState(recomputedIdMatch)} tone={boolToTone(recomputedIdMatch)} />
                </li>
                <li>
                  COSE_Sign1 vs pubkey:{' '}
                  <StatusPill label={boolToState(recomputedSignatureOk)} tone={boolToTone(recomputedSignatureOk)} />
                </li>
                <li>model ref: {modelInfo ?? '—'}</li>
                <li>
                  <span className="font-mono">model_identity_hash</span>
                  <span className="ml-1 text-fg-faint">—</span>
                </li>
                <li>
                  <span className="font-mono">served_by_node_id</span>
                  <span className="ml-1 text-fg-faint">—</span>
                </li>
                <li>digest matches: —</li>
                {/* L4.1 — identity/authority as two facts */}
                <li>
                  <span className="font-mono">identity binding:</span>{' '}
                  <StatusPill
                    label={
                      ownerStatus?.binding === 'bound'
                        ? 'PASS'
                        : ownerStatus?.binding === 'invalid'
                          ? 'FAIL'
                          : 'NOT_PRESENT'
                    }
                    tone={toneForState(
                      ownerStatus?.binding === 'bound'
                        ? 'PASS'
                        : ownerStatus?.binding === 'invalid'
                          ? 'FAIL'
                          : 'NOT_PRESENT'
                    )}
                  />
                  {ownerStatus?.binding === 'bound' && ownerStatus.expiry ? (
                    <span className="ml-1 text-fg-faint">self-asserted, valid to {ownerStatus.expiry}</span>
                  ) : null}
                </li>
                {/* L4.3 — authority always NOT_PRESENT */}
                <li>
                  <span className="font-mono">identity authority:</span>{' '}
                  <StatusPill label="NOT_PRESENT" tone={toneForState('NOT_PRESENT')} />
                  <span className="ml-1 text-fg-faint">not bound to a person</span>
                </li>
                <li>recomputed and verified in your browser, not asserted by this page</li>
              </ol>
              {/* Each chip from the nine-property strip as a row */}
              <div className="mt-2 flex flex-col gap-1">
                {orderedChips.map(({ propKey, label, tone, state }) => (
                  <div key={propKey} className="flex items-center gap-2 text-xs">
                    <StatusPill label={`${label}: ${state}`} tone={tone} />
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-fg-faint">corroborated 0 · contradicted 0 · inconclusive 0</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* 7. Adjudications */}
        {adjudicationCount !== undefined && adjudicationCount > 0 ? (
          <p className="text-xs text-fg-dim">
            {adjudicationCount} adjudication{adjudicationCount === 1 ? '' : 's'} citing this record
          </p>
        ) : null}

        {/* 8. Actions for FAIL states — L3.5 updated vocabulary */}
        {failedProps.length > 0 && !unanswered ? (
          <div className="flex flex-col gap-1.5 pt-1">
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-fg-faint">Actions: </span>
              <button
                type="button"
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
              >
                Restore from copies
              </button>
              <button
                type="button"
                onClick={() => setShowDeclareDialog((v) => !v)}
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
              >
                Declare the break
              </button>
              <button
                type="button"
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
              >
                Ask them for their copy
              </button>
              <button
                type="button"
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
              >
                Record this
              </button>
              <button
                type="button"
                className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
              >
                Stop using this node
              </button>
            </div>
            {showDeclareDialog ? (
              <DeclareBreakDialog
                onConfirm={(_cause) => {
                  setShowDeclareDialog(false)
                }}
                onCancel={() => setShowDeclareDialog(false)}
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// PaneA row adapter — wraps the per-row recomputed identity hook
// ---------------------------------------------------------------------------

function PaneARowCard({ row, nodePubKeyPem }: { row: PaneARow; nodePubKeyPem: string | null }) {
  const identity = useRecomputedIdentity(row.record, nodePubKeyPem)
  const model = row.model_claimed ?? undefined

  // L3.1 — card headline for Balance rows
  const headline = model
    ? `Routed to ${model}; the node signed this answer. Sealed — digest only.`
    : `Sealed record from this node. Sealed — digest only.`

  return (
    <LedgerCard
      exchangeId={row.capsule_id}
      fullCapsuleId={row.capsule_id}
      timestamp={row.timestamp}
      modelInfo={model}
      chipStates={row.rungs}
      recomputedIdMatch={identity.idMatch}
      recomputedSignatureOk={identity.signatureOk}
      headline={headline}
    />
  )
}

// ---------------------------------------------------------------------------
// PaneC row adapter
// ---------------------------------------------------------------------------

function PaneCRowCard({
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

  // Build chip states: exclude content_binding/producer_signature (handled as recomputed)
  const chipStates: Partial<Record<string, PaneState>> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (!RECOMPUTED_PROPERTIES.has(key)) {
      chipStates[key] = value
    }
  }

  // L3.6 — safe optional unanswered field
  const unansweredRaw = (row as Record<string, unknown>).unanswered
  const isUnanswered = unansweredRaw === true

  // L3.1 — exchange card headline
  const headline = isUnanswered
    ? null
    : `Your node kept its half; the other side has ${row.theirs.state !== 'absent' ? 'provided their copy' : 'not provided their copy yet'}.`

  return (
    <LedgerCard
      exchangeId={row.exchange_key}
      timestamp={row.timestamp}
      chipStates={chipStates}
      recomputedIdMatch={identity.idMatch}
      recomputedSignatureOk={identity.signatureOk}
      headline={headline}
      unanswered={isUnanswered}
    />
  )
}

// ---------------------------------------------------------------------------
// Balance section (pane-a)
// ---------------------------------------------------------------------------

function BalanceSection({ nodePubKeyPem }: { nodePubKeyPem: string | null }) {
  const query = useQuery({
    queryKey: ['ledger', 'pane-a'],
    queryFn: () => fetchPaneA(),
    refetchInterval: 15_000,
    retry: false
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }
  if (!query.data || query.data.rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No records on this node's ledger yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {/* L3.1 — Balance section headline */}
      <p className="text-sm text-fg-dim">
        Records sealed by this node. Each one is recomputed locally when you open this page.
      </p>
      {query.data.rows.map((row) => (
        <PaneARowCard key={row.capsule_id} row={row} nodePubKeyPem={nodePubKeyPem} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peers section (pane-b)
// ---------------------------------------------------------------------------

function PeersSection() {
  const query = useQuery({
    queryKey: ['ledger', 'pane-b'],
    queryFn: () => fetchPaneB(),
    refetchInterval: 15_000,
    retry: false
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }
  if (!query.data || query.data.peer_count === 0) {
    return <p className="text-sm text-muted-foreground">No peer exchanges recorded yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {/* L3.1 — Peers section headline */}
      <p className="text-sm text-fg-dim">
        Nodes this node has exchanged with. What you sent, what they sent back, and whether it matched.
      </p>
      {query.data.rows.map((row) => (
        <PeerRowCard key={row.peer_id} row={row} />
      ))}
    </div>
  )
}

function PeerRowCard({ row }: { row: PaneBRow }) {
  const cells: Array<[string, PaneState]> = [
    ['node', row.node],
    ['cross-party', row.rung],
    ['history', row.history],
    ['served', row.served],
    ['verdicts', row.verdicts]
  ]

  return (
    <Card className="mb-2">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-mono text-fg-dim">{row.peer_id}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-1.5">
          {cells.map(([label, cell]) => (
            <StateChip key={label} label={label} cell={cell} />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Exchanges section (pane-c)
// ---------------------------------------------------------------------------

function ExchangesSection({
  recordsById,
  nodePubKeyPem,
  requesterStartedDate
}: {
  recordsById: Map<string, CapsuleRecord>
  nodePubKeyPem: string | null
  requesterStartedDate?: string | null
}) {
  const query = useQuery({
    queryKey: ['ledger', 'pane-c'],
    queryFn: () => fetchPaneCList(),
    refetchInterval: 15_000,
    retry: false
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }

  // L3.7 — Requester empty state
  if (!query.data || query.data.row_count === 0) {
    if (requesterStartedDate) {
      return (
        <p className="text-sm text-muted-foreground">Your node started keeping its half on {requesterStartedDate}.</p>
      )
    }
    return <p className="text-sm text-muted-foreground">No exchanges recorded yet.</p>
  }

  // L3.8 — Two counts — never a ratio
  const total = query.data.row_count
  const confirmed = query.data.rows.filter((r) => r.theirs.state !== 'absent' && !r.unilateral).length

  return (
    <div className="flex flex-col gap-2">
      {/* L3.1 — Exchanges section headline */}
      <p className="text-sm text-fg-dim">
        Each exchange is a pair of sealed records — yours and theirs. Both sides keep a copy.
      </p>
      {/* L3.8 — Two counts, no ratio */}
      <p className="text-sm font-medium text-foreground">
        {total} exchange{total === 1 ? '' : 's'} · {confirmed} confirmed by the other side
      </p>
      {query.data.rows.map((row) => (
        <PaneCRowCard key={row.exchange_key} row={row} recordsById={recordsById} nodePubKeyPem={nodePubKeyPem} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integrity section (pane-a card field)
// ---------------------------------------------------------------------------

function IntegritySection() {
  const query = useQuery({
    queryKey: ['ledger', 'pane-a'],
    queryFn: () => fetchPaneA(),
    refetchInterval: 15_000,
    retry: false
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }

  const card = query.data?.card
  const rows = query.data?.rows ?? []

  if (!card && rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No integrity data available yet.</p>
  }

  // Extract from the card if present
  const checkpointCount = typeof card?.checkpoint_count === 'number' ? card.checkpoint_count : null
  const continuity = typeof card?.continuity === 'string' ? card.continuity : null
  const witnesses: unknown[] = Array.isArray(card?.witnesses) ? (card.witnesses as unknown[]) : []
  const witnessCount = witnesses.length

  // L4.2 — owner-added-later headline
  const ownerAddedAt = typeof card?.owner_added_at === 'string' ? card.owner_added_at : null
  const ownerCardIndex = typeof card?.owner_card_index === 'number' ? card.owner_card_index : null

  // L3.1 — Integrity headline
  const integrityHeadline = `Your history is intact and registered with ${witnessCount} witness${witnessCount === 1 ? '' : 'es'} (run by the mesh team, not you). ${rows.length} exchange${rows.length === 1 ? '' : 's'} served, all sealed.`

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Chain integrity</CardTitle>
        {/* L3.1 — section headline inside the Integrity card */}
        <p className="text-xs text-fg-dim mt-1">{integrityHeadline}</p>
        {/* L4.2 — owner-added-later notice */}
        {ownerAddedAt && ownerCardIndex !== null ? (
          <p className="text-xs text-fg-dim mt-1">
            Owner bound from {ownerAddedAt} (card #{ownerCardIndex}); earlier records are unowned.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0 text-sm text-fg-dim">
        {continuity ? (
          <p>
            Continuity: <span className="font-medium text-foreground">{continuity}</span>
          </p>
        ) : null}
        {checkpointCount !== null ? <p>Checkpoints: {checkpointCount}</p> : null}
        {witnessCount > 0 ? (
          <p>
            Registered at {witnessCount} witness{witnessCount === 1 ? '' : 'es'}
          </p>
        ) : null}
        {!continuity && checkpointCount === null && witnessCount === 0 ? (
          <p className="text-muted-foreground">No integrity fields available in the current data.</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function LedgerPageContent() {
  // Fetch the local ledger once for all sections that need in-browser recompute
  const ledgerQuery = useQuery({
    queryKey: ['capsules', 'ledger'],
    queryFn: fetchCapsuleLedger,
    refetchInterval: 15_000
  })

  // Shares its cache with BalanceSection/IntegritySection's own pane-a query
  // (same queryKey) -- used here only to drive the header's connectivity badge.
  const paneAStatusQuery = useQuery({
    queryKey: ['ledger', 'pane-a'],
    queryFn: () => fetchPaneA(),
    refetchInterval: 15_000,
    retry: false
  })

  const recordsById = useMemo(() => {
    const map = new Map<string, CapsuleRecord>()
    for (const record of ledgerQuery.data?.records ?? []) {
      if (record.capsule_id) map.set(record.capsule_id, record)
    }
    return map
  }, [ledgerQuery.data])

  const nodePubKeyPem = ledgerQuery.data?.nodePubKeyPem ?? null
  const sidecarConnected = paneAStatusQuery.isSuccess

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-[calc(var(--shell-normal)*2)]">
        <InfoBanner
          description="Everything here is recomputed from sealed records. Nothing is a score."
          leadingIcon={<ShieldCheck aria-hidden="true" className="size-4" />}
          status={
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge dot size="caption" tone={sidecarConnected ? 'good' : 'muted'}>
                {sidecarConnected ? 'Live' : 'Local'}
              </StatusBadge>
              <StatusBadge tone="muted" size="caption">
                Local only
              </StatusBadge>
            </div>
          }
          title="Ledger"
          titleId="ledger-title"
          titleLevel="h1"
        />

        <Card className="overflow-hidden rounded-[var(--radius-lg)] border-border bg-panel p-4 shadow-none">
          <TabPanel<LedgerTab>
            ariaLabel="Ledger sections"
            defaultValue="balance"
            stretchTabs={false}
            contentClassName="px-0 pt-4"
            tabs={[
              {
                value: 'balance',
                label: 'Balance',
                content: <BalanceSection nodePubKeyPem={nodePubKeyPem} />
              },
              {
                value: 'peers',
                label: 'Peers',
                content: (
                  <div>
                    <p className="mb-3 text-sm text-fg-dim">What have the nodes you have dealt with shown you?</p>
                    <PeersSection />
                  </div>
                )
              },
              {
                value: 'exchanges',
                label: 'Exchanges',
                content: <ExchangesSection recordsById={recordsById} nodePubKeyPem={nodePubKeyPem} />
              },
              {
                value: 'integrity',
                label: 'Integrity',
                content: <IntegritySection />
              }
            ]}
          />
        </Card>
      </div>
    </TooltipProvider>
  )
}
