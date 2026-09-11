// [mesh-live-tab-pane-proxy] L3/L4, [mesh-ledger-earned-pass-and-native-panes]
// Part B: Ledger tab — four sections (Balance / Peers / Exchanges /
// Integrity) replacing the prior four sub-tabs. Data comes from this host's
// own `/api/capsules/panes/*` route, which forwards server-side to the
// capsule-emit-mesh sidecar -- the user never configures anything; honest
// absent states where data is unavailable.
//
// Security boundary: NO user-visible strings may name internal tooling,
// internal item IDs, or any branded service name. Comments are exempt.
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FilterPopover, type FilterValueOption } from '@/components/ui/FilterPopover'
import { InfoBanner } from '@/components/ui/InfoBanner'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TabPanel } from '@/components/ui/TabPanel'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import type { CapsuleRecord, JsonRecord } from '@/features/capsules/api/types'
import { PaneFetchError, fetchPaneA, fetchPaneB, fetchPaneCList } from '@/features/capsules/api/sidecarClient'
import { balanceCoverage } from '@/features/capsules/lib/balance-view'
import { PeerCard } from '@/features/capsules/components/PeerCard'
import { ExchangeInspector } from '@/features/capsules/components/ExchangeInspector'
import { ExchangeStreamRow } from '@/features/capsules/components/ExchangeStreamRow'
import {
  buildExchangeCounterpartyIndex,
  buildExchangeLedgerRows,
  type ExchangeLedgerRow
} from '@/features/capsules/lib/exchange-ledger'
import { buildRailSegments, sortStreamByTime } from '@/features/capsules/lib/exchange-stream'
import { exchangeEvidenceBundle, exchangeRowsToCsv, saveTextFile } from '@/features/capsules/lib/exchange-export'
import { HARNESS_PANE_A_PAYLOAD, HARNESS_PANE_C_PAYLOAD } from '@/features/capsules/lib/exchange-fixtures'
import {
  HARNESS_PANE_B_PAYLOAD,
  PEER_TAB_HARNESS_EXCHANGE_SOURCES,
  PEER_TAB_HARNESS_LEDGER_RECORDS,
  PEER_TAB_HARNESS_MESH_MODELS,
  PEER_TAB_HARNESS_MESH_PEERS
} from '@/features/capsules/lib/peer-fixtures'
import { livePeerExchangeSources } from '@/features/capsules/lib/peer-exchange-timeline'
import { usePeerMeshStatusIndex } from '@/features/capsules/lib/peer-mesh-status'
import { peerDisplayId, peerSortKey, sortPeerRows } from '@/features/capsules/lib/peer-row-view'
import { useDataMode } from '@/lib/data-mode'

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

type LedgerTab = 'peers' | 'exchanges' | 'integrity'

// ---------------------------------------------------------------------------
// Balance header strip (pane-a's card.served_summary) — sits above the
// Exchanges records table. Retired the standalone Balance tab entirely;
// this is the quantity answer, records are the list below it.
// ---------------------------------------------------------------------------

function ExchangesBalanceHeader({ card }: { card: JsonRecord | null | undefined }) {
  const coverage = balanceCoverage(card)

  if (coverage.kind === 'absent') {
    return (
      <div className="rounded border border-border-soft bg-panel-strong/40 px-3 py-2 text-xs text-fg-dim">
        {coverage.headline}
      </div>
    )
  }
  if (coverage.kind === 'failed') {
    return (
      <div className="rounded border border-border-soft bg-panel-strong/40 px-3 py-2 text-xs text-amber-500">
        {coverage.headline}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-1 rounded border border-border-soft bg-panel-strong/40 px-3 py-2">
      <p className="text-sm font-medium text-foreground">Served: {coverage.servedText}</p>
      <p className="text-xs text-fg-dim">{coverage.consumedText}</p>
      <p className="text-xs text-fg-faint">{coverage.statement}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peers section (pane-b)
// ---------------------------------------------------------------------------

function PeersSection({ recordsById }: { recordsById: Map<string, CapsuleRecord> }) {
  const { mode } = useDataMode()
  const harnessMode = mode === 'harness'
  const query = useQuery({
    queryKey: ['ledger', 'pane-b', mode],
    queryFn: () => (harnessMode ? Promise.resolve(HARNESS_PANE_B_PAYLOAD) : fetchPaneB()),
    refetchInterval: 15_000,
    retry: false
  })
  // Shares its cache with ExchangesSection's own pane-c query (same
  // queryKey) -- the per-exchange timeline (Phase 2) joins this peer's
  // exchange_ids against the same list, never a second fetch.
  const paneCQuery = useQuery({
    queryKey: ['ledger', 'pane-c'],
    queryFn: () => fetchPaneCList(),
    refetchInterval: 15_000,
    retry: false,
    enabled: !harnessMode
  })
  const meshStatus = usePeerMeshStatusIndex(PEER_TAB_HARNESS_MESH_PEERS, PEER_TAB_HARNESS_MESH_MODELS)
  const effectiveRecordsById = harnessMode ? PEER_TAB_HARNESS_LEDGER_RECORDS : recordsById

  const resolveTimestamp = (capsuleId: string): string | null => effectiveRecordsById.get(capsuleId)?.timestamp ?? null

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }
  if (!query.data || query.data.peer_count === 0) {
    return <p className="text-sm text-muted-foreground">No peer exchanges recorded yet.</p>
  }

  // Closest-first (latency asc); any row carrying an alarm floats to top.
  const sortedRows = sortPeerRows(query.data.rows, (row) =>
    peerSortKey(row, meshStatus.statusFor(peerDisplayId(row))?.latencyMs ?? null)
  )

  return (
    <div className="flex flex-col gap-2">
      {/* L3.1 — Peers section headline */}
      <p className="text-sm text-fg-dim">
        Nodes this node has exchanged with. What you sent, what they sent back, and whether it matched.
      </p>
      {sortedRows.map((row) => {
        const peerId = peerDisplayId(row)
        const exchangeSources = harnessMode
          ? (PEER_TAB_HARNESS_EXCHANGE_SOURCES[peerId] ?? [])
          : livePeerExchangeSources(row, paneCQuery.data?.rows ?? [])
        return (
          <PeerCard
            exchangeSources={exchangeSources}
            key={row.peer_id ?? peerId}
            meshStatus={meshStatus.statusFor(peerId)}
            recordsById={effectiveRecordsById}
            resolveTimestamp={resolveTimestamp}
            row={row}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Exchanges section (pane-c)
// ---------------------------------------------------------------------------

type ExchangeFilterKey = 'role' | 'checks'

const ALL_ROLE_VALUES = ['SERVED', 'ASKED']
const ALL_CHECKS_VALUES = ['clean', 'exception']

function exchangeFilterOptionLabel(value: string): string {
  if (value === 'SERVED') return 'Served'
  if (value === 'ASKED') return 'Asked'
  if (value === 'clean') return 'Clean'
  return 'Exception'
}

function ExchangesSection({
  recordsById,
  nodePubKeyPem,
  requesterStartedDate
}: {
  recordsById: Map<string, CapsuleRecord>
  nodePubKeyPem: string | null
  requesterStartedDate?: string | null
}) {
  const { mode } = useDataMode()
  const harnessMode = mode === 'harness'
  // Distinct queryKey from the top-level/Integrity pane-a query (no `mode`
  // suffix there) — this one's queryFn branches on harness mode, and a
  // shared key with a non-branching queryFn would race for cache ownership.
  const balanceQuery = useQuery({
    queryKey: ['ledger', 'pane-a', 'balance', mode],
    queryFn: () => (harnessMode ? Promise.resolve(HARNESS_PANE_A_PAYLOAD) : fetchPaneA()),
    refetchInterval: 15_000,
    retry: false
  })
  // Same queryKey as PeersSection's own pane-c query (no `mode` suffix) --
  // that one calls the identical `fetchPaneCList()` in live mode and is
  // simply `enabled: false` in harness mode, so both share ONE cache entry
  // / one real fetch, same discipline PeersSection's own comment documents.
  const query = useQuery({
    queryKey: ['ledger', 'pane-c'],
    queryFn: () => (harnessMode ? Promise.resolve(HARNESS_PANE_C_PAYLOAD) : fetchPaneCList()),
    refetchInterval: 15_000,
    retry: false
  })
  // Same queryKey + queryFn SHAPE as PeersSection's own pane-b query (both
  // branch on harness mode identically) -- a symmetric pair shares one
  // cache entry safely; an asymmetric one is the race that bit the pane-c
  // key during Part 1 (see the outbox/commit history for that fix).
  const paneBQuery = useQuery({
    queryKey: ['ledger', 'pane-b', mode],
    queryFn: () => (harnessMode ? Promise.resolve(HARNESS_PANE_B_PAYLOAD) : fetchPaneB()),
    refetchInterval: 15_000,
    retry: false
  })

  const counterpartyIndex = useMemo(
    () => buildExchangeCounterpartyIndex(paneBQuery.data?.rows ?? []),
    [paneBQuery.data]
  )
  const allRows = useMemo(
    () => buildExchangeLedgerRows(query.data?.rows ?? [], counterpartyIndex),
    [query.data, counterpartyIndex]
  )

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Set<string>>(new Set(ALL_ROLE_VALUES))
  const [checksFilter, setChecksFilter] = useState<Set<string>>(new Set(ALL_CHECKS_VALUES))
  const [selectedExchangeKey, setSelectedExchangeKey] = useState<string | null>(null)
  const handleExchangeRowActivate = useCallback((row: ExchangeLedgerRow) => setSelectedExchangeKey(row.exchangeKey), [])

  const trimmedSearch = search.trim().toLowerCase()
  const visibleRows = useMemo(
    () =>
      allRows.filter((row) => {
        if (!roleFilter.has(row.roleTag)) return false
        if (!checksFilter.has(row.hasIssue ? 'exception' : 'clean')) return false
        if (!trimmedSearch) return true
        return `${row.exchangeKey} ${row.counterparty ?? ''}`.toLowerCase().includes(trimmedSearch)
      }),
    [allRows, roleFilter, checksFilter, trimmedSearch]
  )

  // L-N — one time-ordered append-only stream; nothing but time (and the
  // exchangeKey tie-break) reorders it. Filtering above may drop rows, but
  // never reorders the ones that remain.
  const streamRows = useMemo(() => sortStreamByTime(visibleRows), [visibleRows])
  const railSegments = useMemo(() => buildRailSegments(streamRows), [streamRows])

  const selectedRow = selectedExchangeKey
    ? (allRows.find((r) => r.exchangeKey === selectedExchangeKey)?.raw ?? null)
    : null
  const selectedCounterparty = selectedExchangeKey ? (counterpartyIndex.get(selectedExchangeKey) ?? null) : null
  const selectedLocalRecord =
    selectedRow?.mine.capsule_id != null ? (recordsById.get(selectedRow.mine.capsule_id) ?? null) : null

  const balanceHeader = <ExchangesBalanceHeader card={balanceQuery.data?.card ?? null} />

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {balanceHeader}
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }
  if (query.isError) {
    return (
      <div className="flex flex-col gap-2">
        {balanceHeader}
        <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
      </div>
    )
  }

  // L3.7 — Requester empty state
  if (!query.data || query.data.row_count === 0) {
    return (
      <div className="flex flex-col gap-2">
        {balanceHeader}
        {requesterStartedDate ? (
          <p className="text-sm text-muted-foreground">Your node started keeping its half on {requesterStartedDate}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">No exchanges recorded yet.</p>
        )}
      </div>
    )
  }

  // L3.8 — Two counts — never a ratio
  const total = query.data.row_count
  const confirmed = query.data.rows.filter((r) => r.theirs.state !== 'absent' && !r.unilateral).length

  const roleOptions: FilterValueOption[] = ALL_ROLE_VALUES.map((value) => ({
    value,
    count: allRows.filter((r) => r.roleTag === value).length
  }))
  const checksOptions: FilterValueOption[] = ALL_CHECKS_VALUES.map((value) => ({
    value,
    count: allRows.filter((r) => (r.hasIssue ? 'exception' : 'clean') === value).length
  }))
  const activeFilterGroups =
    (roleFilter.size < ALL_ROLE_VALUES.length ? 1 : 0) + (checksFilter.size < ALL_CHECKS_VALUES.length ? 1 : 0)

  return (
    <div className="flex flex-col gap-2">
      {balanceHeader}
      {/* L3.1 — Exchanges section headline */}
      <p className="text-sm text-fg-dim">
        Each exchange is a pair of sealed records — yours and theirs. Both sides keep a copy.
      </p>
      {/* L3.8 — Two counts, no ratio */}
      <p className="text-sm font-medium text-foreground">
        {total} exchange{total === 1 ? '' : 's'} · {confirmed} confirmed by the other side
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft pb-2">
        <p className="type-caption font-mono text-fg-dim">
          {visibleRows.length === allRows.length ? visibleRows.length : `${visibleRows.length} of ${allRows.length}`}{' '}
          shown
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-faint"
            />
            <Input
              aria-label="Search exchanges"
              className="ui-control h-8 w-52 rounded-[var(--radius)] border-border-soft pl-8 text-[length:var(--density-type-caption)]"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Exchange ID or counterparty…"
              value={search}
            />
          </div>
          <FilterPopover<ExchangeFilterKey>
            activeFilterGroups={activeFilterGroups}
            categories={[
              { key: 'role', label: 'Your role' },
              { key: 'checks', label: 'Checks' }
            ]}
            contentLabel="Exchange filters"
            formatOptionLabel={exchangeFilterOptionLabel}
            id="exchange-ledger-filters"
            itemLabel="exchanges"
            onClear={() => {
              setRoleFilter(new Set(ALL_ROLE_VALUES))
              setChecksFilter(new Set(ALL_CHECKS_VALUES))
            }}
            onSelectAll={(key) =>
              key === 'role' ? setRoleFilter(new Set(ALL_ROLE_VALUES)) : setChecksFilter(new Set(ALL_CHECKS_VALUES))
            }
            onSelectNone={(key) => (key === 'role' ? setRoleFilter(new Set()) : setChecksFilter(new Set()))}
            onValueChange={(key, value, checked) => {
              const setFilter = key === 'role' ? setRoleFilter : setChecksFilter
              setFilter((prev) => {
                const next = new Set(prev)
                if (checked) next.add(value)
                else next.delete(value)
                return next
              })
            }}
            optionsByCategory={{ role: roleOptions, checks: checksOptions }}
            selectedValuesByCategory={{ role: roleFilter, checks: checksFilter }}
            title="Exchange filters"
            totalCount={allRows.length}
            triggerLabel="Filter exchanges"
            visibleCount={visibleRows.length}
          />
          {/* Two distinct actions, never collapsed: a CSV of the current
             view vs. the portable evidence bundle (full records). */}
          <Button
            className="ui-control h-8 gap-1.5 rounded-[var(--radius)] px-2.5 text-[length:var(--density-type-caption)]"
            onClick={() => saveTextFile('mesh-exchanges-view.csv', exchangeRowsToCsv(visibleRows), 'text/csv')}
            size="sm"
            type="button"
            variant="outline"
          >
            Export view (CSV)
          </Button>
          <Button
            className="ui-control h-8 gap-1.5 rounded-[var(--radius)] px-2.5 text-[length:var(--density-type-caption)]"
            onClick={() =>
              saveTextFile(
                'mesh-exchanges-evidence.json',
                exchangeEvidenceBundle(visibleRows.map((visibleRow) => visibleRow.raw)),
                'application/json'
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Save evidence file
          </Button>
        </div>
      </div>

      {/* v3 §2 — one time-ordered, append-only stream (L-N), replacing the
         flat table + `Confirmed` chip column with a real two-sided row per
         exchange. Toggles ① content / ② checks (§3/§4) are later batches;
         a row (or its in-cell action) still opens the existing full-detail
         inspector modal below. */}
      {streamRows.length === 0 ? (
        <p aria-label="Exchange records" className="py-6 text-center text-sm text-fg-dim" role="status">
          No exchanges match this filter.
        </p>
      ) : (
        <div aria-label="Exchange records" className="flex flex-col divide-y divide-border-soft" role="list">
          {streamRows.map((row, index) => (
            <ExchangeStreamRow
              key={row.exchangeKey}
              onAction={handleExchangeRowActivate}
              onActivate={handleExchangeRowActivate}
              rail={railSegments[index]}
              row={row}
            />
          ))}
        </div>
      )}

      <ExchangeInspector
        counterparty={selectedCounterparty}
        localRecord={selectedLocalRecord}
        nodePubKeyPem={nodePubKeyPem}
        onClose={() => setSelectedExchangeKey(null)}
        row={selectedRow}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integrity section (pane-a card field + pane-c first-person exchange
// outcomes) -- [mesh-ledger-b1-integrity-chain-strip]. Replaces the old
// two-sentence paragraph (which could say "intact and registered with 0
// witnesses" AND "no integrity fields available" about the same node) with
// a chain strip + four first-person stat cards. Per v2 §6/R-D these counts
// describe THIS node's own chain, never a peer, so the full Logs stat-card
// prominence treatment is allowed here.
// ---------------------------------------------------------------------------

/** The chain strip: a bar of this node's sealed entries, shading the
 *  checkpoint-covered range when a checkpoint exists. */
function ChainStrip({ sealedCount, checkpointCount }: { sealedCount: number; checkpointCount: number | null }) {
  const hasCheckpoint = checkpointCount !== null && checkpointCount > 0
  const coveredCount = hasCheckpoint ? Math.min(checkpointCount, sealedCount) : 0
  const coveredPct = sealedCount > 0 ? (coveredCount / sealedCount) * 100 : 0

  return (
    <div className="flex flex-col gap-1">
      <p className="type-caption font-mono text-fg-faint">Your chain</p>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-fg-faint">1</span>
        <div
          className="relative h-4 flex-1 overflow-hidden rounded bg-panel-strong/40"
          role="img"
          aria-label={`Sealed chain, ${sealedCount} entries`}
        >
          {sealedCount > 0 ? (
            <>
              <div className="absolute inset-y-0 left-0 bg-foreground/70" style={{ width: `${coveredPct}%` }} />
              <div className="absolute inset-y-0 bg-foreground/25" style={{ left: `${coveredPct}%`, right: 0 }} />
            </>
          ) : null}
        </div>
        <span className="font-mono text-xs text-fg-faint">{sealedCount}</span>
      </div>
      <p className="type-caption text-fg-dim">
        {hasCheckpoint
          ? `covered by checkpoint (${checkpointCount} leaves) · after the last checkpoint is unshaded`
          : `${sealedCount} entr${sealedCount === 1 ? 'y' : 'ies'}, all sealed · no checkpoint yet · nothing here is registered`}
      </p>
    </div>
  )
}

type IntegrityStatCardProps = {
  readonly label: string
  readonly value: number
  readonly tone?: 'default' | 'bad'
}

/** One first-person stat card. A zero renders in the exact same size/weight
 *  as any other value -- never muted, never apologetic (Accept criterion). */
function IntegrityStatCard({ label, value, tone = 'default' }: IntegrityStatCardProps) {
  const valueColor = tone === 'bad' && value > 0 ? 'var(--color-bad)' : 'var(--color-foreground)'
  return (
    <div className="panel-shell min-w-0 rounded-[var(--radius-lg)] border border-border bg-panel px-[var(--panel-x)] py-[var(--panel-y)]">
      <span className="type-label truncate text-fg-faint">{label}</span>
      <div
        className="mt-[var(--panel-y,12px)] font-mono text-[length:var(--density-type-headline)] font-semibold leading-none tracking-tight"
        style={{ color: valueColor }}
      >
        {value}
      </div>
    </div>
  )
}

function IntegritySection() {
  const { mode } = useDataMode()
  const harnessMode = mode === 'harness'
  const query = useQuery({
    queryKey: ['ledger', 'pane-a'],
    queryFn: () => fetchPaneA(),
    refetchInterval: 15_000,
    retry: false
  })
  // Same queryKey + queryFn shape as ExchangesSection's own pane-c query --
  // needed here for the CLOSED BY THE OTHER SIDE / CONTRADICTED cards,
  // first-person counts derived from this node's own exchange records.
  const paneCQuery = useQuery({
    queryKey: ['ledger', 'pane-c'],
    queryFn: () => (harnessMode ? Promise.resolve(HARNESS_PANE_C_PAYLOAD) : fetchPaneCList()),
    refetchInterval: 15_000,
    retry: false
  })

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError) {
    return <p className="text-sm text-amber-500">{describePaneError(query.error)}</p>
  }

  const card = query.data?.card
  const rows = query.data?.rows ?? []
  const paneCRows = paneCQuery.data?.rows ?? []

  // Extract from the card if present
  const checkpointCount = typeof card?.checkpoint_count === 'number' ? card.checkpoint_count : null
  const continuity = typeof card?.continuity === 'string' ? card.continuity : null
  const witnesses: unknown[] = Array.isArray(card?.witnesses) ? (card.witnesses as unknown[]) : []
  const witnessCount = witnesses.length

  // L4.2 — owner-added-later headline
  const ownerAddedAt = typeof card?.owner_added_at === 'string' ? card.owner_added_at : null
  const ownerCardIndex = typeof card?.owner_card_index === 'number' ? card.owner_card_index : null

  const sealedCount = rows.length
  const closedByOtherSideCount = paneCRows.filter((row) => row.theirs.state !== 'absent' && !row.unilateral).length
  const contradictedCount = paneCRows.filter((row) => row.properties?.outcome_corroboration?.state === 'FAIL').length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Chain integrity</CardTitle>
        {/* L4.2 — owner-added-later notice */}
        {ownerAddedAt && ownerCardIndex !== null ? (
          <p className="text-xs text-fg-dim mt-1">
            Owner bound from {ownerAddedAt} (card #{ownerCardIndex}); earlier records are unowned.
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 text-sm text-fg-dim">
        <ChainStrip checkpointCount={checkpointCount} sealedCount={sealedCount} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <IntegrityStatCard label="Sealed" value={sealedCount} />
          <IntegrityStatCard label="Registered" value={witnessCount} />
          <IntegrityStatCard label="Closed by the other side" value={closedByOtherSideCount} />
          <IntegrityStatCard label="Contradicted" tone="bad" value={contradictedCount} />
        </div>
        {continuity ? (
          <p>
            Continuity: <span className="font-medium text-foreground">{continuity}</span>
          </p>
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

  // Shares its cache with IntegritySection's own pane-a query (same
  // queryKey) -- used here only to drive the header's connectivity badge.
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
            defaultValue="peers"
            stretchTabs={false}
            contentClassName="px-0 pt-4"
            tabs={[
              {
                value: 'peers',
                label: 'Peers',
                content: (
                  <div>
                    <p className="mb-3 text-sm text-fg-dim">What have the nodes you have dealt with shown you?</p>
                    <PeersSection recordsById={recordsById} />
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
