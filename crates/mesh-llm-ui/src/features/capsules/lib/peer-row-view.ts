// Pure view-model derivation for a Pane B row ([mesh-ledger-peers-tab]).
// Kept separate from the rendering components so the honesty-backbone
// invariants (denominators always present, NOT_CHECKED never summarized as
// corroborated, with-you and their-chain never summed) are unit-testable
// without mounting a component.
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'

export const STATE_NOT_CHECKED = 'NOT_CHECKED'
export const STATE_CONTRADICTED = 'contradicted'
export const STATE_FAILED = 'failed'
export const STATE_REFUSED = 'refused'
export const STATE_VERIFIED = 'verified'

/** `null` means this row carries no counterparty identity at all -- pane-b's
 *  own honest signal that these exchanges are unattributed, not that one
 *  peer's identity failed to resolve (design chooser-v1 §7 S1.1). Never
 *  invent a placeholder string for this case; callers render "counterparty
 *  not recorded" / exclude the row from the Peers list instead. */
export function peerDisplayId(row: PaneBRow): string | null {
  return row.peer_id ?? row.node?.peer_id ?? null
}

/** True when this row has no counterparty identity (see `peerDisplayId`) --
 *  the Peers list never renders a card for these; they're rolled into the
 *  unattributed-exchanges line instead. */
export function isUnattributedPeerRow(row: PaneBRow): boolean {
  return peerDisplayId(row) === null
}

/** The Peers-section headline for exchanges with no counterparty evidence
 *  at all -- a stated fact (R-C), never phrased as pending work. */
export function unattributedExchangesLine(count: number): string {
  const subject = count === 1 ? 'exchange has' : 'exchanges have'
  return `${count} ${subject} no counterparty recorded yet. They appear under Exchanges.`
}

/** Used by the modal's Overview tab (`PeerInspector`) for the self-reported
 *  model/quant/context line -- the summary table no longer renders this
 *  (accountability, not operational-announcement, per [a18-evidence-peers-
 *  dedup-network]), but the deep-dive inspector still does. */
export function meshMetaLine(meshStatus: PeerMeshStatus | null): string | null {
  if (!meshStatus) return null
  const parts = [
    meshStatus.modelName,
    meshStatus.quant,
    meshStatus.contextLengthK != null ? `${meshStatus.contextLengthK}k ctx` : null
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

// ---------------------------------------------------------------------------
// With-you (verifiable, front) -- never summed with their-chain facts.
// Still used by the modal's Overview tab (`PeerInspector`).
// ---------------------------------------------------------------------------

export type WithYouCounts = { requested: number; served: number; confirmed: number }

/** `requested`/`served` from `role_and_count_cell` (direction of exchange,
 *  never a trust signal); `confirmed` from `pair_cell.verified` -- the
 *  count of exchange_ids where both halves' digests actually reconciled,
 *  the one real "both sides agree" fact this row carries. */
export function withYouCounts(row: PaneBRow): WithYouCounts {
  return {
    requested: row.role?.you_to_them_count ?? 0,
    served: row.role?.them_to_you_count ?? 0,
    confirmed: row.pair?.verified ?? 0
  }
}

export function withYouCountsText(counts: WithYouCounts): string {
  return `${counts.requested} requested · ${counts.served} served · ${counts.confirmed} confirmed`
}

// ---------------------------------------------------------------------------
// Adjudication -- always carries a denominator; NOT_CHECKED is never a
// silent pass.
// ---------------------------------------------------------------------------

export type AdjudicationSummary = {
  checked: number
  denominator: number
  corroborated: number
  contradicted: number
  inconclusive: number
  notChecked: boolean
}

/** `denominator` is `exchange_count` (every exchange this row has with the
 *  peer) -- `verdicts_cell` draws its tally from adjudications naming ANY
 *  of this peer's capsule ids, not only the requested-by-you half, so a
 *  narrower denominator would overclaim scope. */
export function adjudicationSummary(row: PaneBRow): AdjudicationSummary {
  const tally = row.verdicts?.tally
  const corroborated = tally?.corroborated ?? 0
  const contradicted = tally?.contradicted ?? 0
  const inconclusive = tally?.inconclusive ?? 0
  const checked = corroborated + contradicted + inconclusive
  const notChecked = row.verdicts?.state === STATE_NOT_CHECKED || checked === 0
  return {
    checked,
    denominator: row.exchange_count ?? 0,
    corroborated,
    contradicted,
    inconclusive,
    notChecked
  }
}

/** Never returns a corroborated-sounding sentence when `notChecked` is
 *  true -- that branch is checked first and returns before the tally is
 *  ever read. */
export function adjudicationSummaryText(summary: AdjudicationSummary): string {
  if (summary.notChecked) {
    return 'Not yet checked — no adjudication sealed for this peer yet.'
  }
  const parts: string[] = []
  if (summary.corroborated) parts.push(`${summary.corroborated} corroborated`)
  if (summary.contradicted) parts.push(`${summary.contradicted} contradicted`)
  if (summary.inconclusive) parts.push(`${summary.inconclusive} inconclusive`)
  return `${summary.checked} of ${summary.denominator} adjudicated · ${parts.join(' · ')}`
}

/** Compact form of `adjudicationSummaryText` for the Peers table's
 *  narrower ADJUDICATION column -- same honesty invariant (never
 *  "corroborated"-sounding when `notChecked`), just terser wording. */
export function adjudicationCompactText(summary: AdjudicationSummary): string {
  if (summary.notChecked) return 'none sealed'
  const parts: string[] = []
  if (summary.corroborated) parts.push(`${summary.corroborated} corroborated`)
  if (summary.contradicted) parts.push(`${summary.contradicted} contradicted`)
  if (summary.inconclusive) parts.push(`${summary.inconclusive} inconclusive`)
  return `${summary.checked} of ${summary.denominator} · ${parts.join(' · ')}`
}

// ---------------------------------------------------------------------------
// Their chain (secondary) -- you verified it's unbroken/unforked, never its
// contents. Never summed with with-you facts.
// ---------------------------------------------------------------------------

export type ChainSummary = {
  text: string
  state: string
  /** True when this cell has no peer-fetch data and is only carrying this
   *  node's OWN chain as `mine_for_reference` -- the UI must label that
   *  clearly as "for reference", never present it as the peer's. */
  ownChainForReferenceOnly: boolean
}

export function theirChainSummary(row: PaneBRow): ChainSummary {
  const cell = row.history
  const state = cell?.state ?? STATE_NOT_CHECKED

  if (state === STATE_VERIFIED && cell?.history_summary) {
    const checkpointCount = cell.history_summary.checkpoint_count
    const bundles = cell.history_summary.verified_bundles
    return {
      text: `Unbroken — you verified their chain (their count: ${checkpointCount ?? '?'} checkpoint(s), ${bundles ?? '?'} bundle(s)).`,
      state,
      ownChainForReferenceOnly: false
    }
  }
  if (state === STATE_FAILED) {
    return {
      text: 'Verification failed — could not confirm their chain is unbroken.',
      state,
      ownChainForReferenceOnly: false
    }
  }
  if (state === STATE_REFUSED) {
    return { text: 'Peer refused to share their chain.', state, ownChainForReferenceOnly: false }
  }
  return {
    text: "Not yet checked — this view has no way to fetch the peer's own chain yet.",
    state: STATE_NOT_CHECKED,
    ownChainForReferenceOnly: Boolean(cell?.mine_for_reference)
  }
}

// ---------------------------------------------------------------------------
// Confirmed by other side -- the on-demand peer-fetch mechanism
// (mesh-e9e10-pieces-3-4), distinct from `matchTally` below (which is this
// node's own two-sided-capture reconciliation, a different, already-local
// signal). `theirChainSummary` is a PEER-LEVEL fact (their whole chain
// verified/failed/refused/not-checked) -- no sidecar emits a per-exchange
// peer-fetch tally, so a `verified` state counts as every exchange
// confirmed (never invented partial credit), and every other state counts
// as zero with an honest note naming why.
// ---------------------------------------------------------------------------

export type ConfirmedByOtherSide = { confirmed: number; total: number; note: string | null }

export function confirmedByOtherSide(row: PaneBRow): ConfirmedByOtherSide {
  const total = row.exchange_count ?? 0
  const chain = theirChainSummary(row)
  if (chain.state === STATE_VERIFIED) {
    return { confirmed: total, total, note: null }
  }
  if (chain.state === STATE_FAILED) {
    return { confirmed: 0, total, note: 'peer-fetch failed' }
  }
  if (chain.state === STATE_REFUSED) {
    return { confirmed: 0, total, note: 'peer refused' }
  }
  return { confirmed: 0, total, note: 'peer-fetch pending' }
}

export function confirmedByOtherSideText(summary: ConfirmedByOtherSide): string {
  const base = `${summary.confirmed} / ${summary.total}`
  return summary.note ? `${base} (${summary.note})` : base
}

// ---------------------------------------------------------------------------
// Match -- local two-sided-capture reconciliation (`pair_cell`) plus any
// contradiction a sealed adjudication later found. `clean`/`mismatch`
// always both render (even at zero); `contradicted` only appears when
// nonzero -- a peer with no contradiction has never had one, not "0 of
// them", the same zero-is-a-fact-not-silence discipline as
// `adjudicationSummaryText`.
// ---------------------------------------------------------------------------

export type MatchTally = { clean: number; mismatch: number; contradicted: number }

export function matchTally(row: PaneBRow): MatchTally {
  return {
    clean: row.pair?.verified ?? 0,
    mismatch: row.pair?.failed ?? 0,
    contradicted: row.verdicts?.tally?.contradicted ?? 0
  }
}

export function matchTallyText(tally: MatchTally): string {
  const parts = [`${tally.clean} clean`, `${tally.mismatch} mismatch`]
  if (tally.contradicted) parts.push(`${tally.contradicted} contradicted`)
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------
// Alarm -- the most-recent negative signal, surfaced even collapsed.
// ---------------------------------------------------------------------------

export type AlarmSignal = { present: boolean; text: string; tone: 'bad' | 'warn' }

/** `resolveTimestamp` is an optional local-ledger lookup (the Ledger page
 *  already has `recordsById` from the raw capsule ledger) so a contradiction
 *  date can be shown when it's genuinely recoverable -- never fabricated
 *  when it isn't. */
export function alarmSignal(row: PaneBRow, resolveTimestamp?: (capsuleId: string) => string | null): AlarmSignal {
  const verdicts = row.verdicts
  if (verdicts?.state === STATE_CONTRADICTED) {
    const capsuleId = verdicts.adjudication_capsule_id
    const when = capsuleId ? (resolveTimestamp?.(capsuleId) ?? null) : null
    return { present: true, text: when ? `Contradiction found ${when}` : 'Contradiction found', tone: 'bad' }
  }
  if (row.history?.state === STATE_FAILED) {
    return { present: true, text: 'Chain verification failed', tone: 'bad' }
  }
  if (row.history?.state === STATE_REFUSED || row.served?.state === STATE_REFUSED) {
    return { present: true, text: 'Peer refused a request', tone: 'warn' }
  }
  return { present: false, text: '', tone: 'warn' }
}

// ---------------------------------------------------------------------------
// Sort -- closest-first, alarms float to top. Never a trust ordering.
// ---------------------------------------------------------------------------

export function peerSortKey(row: PaneBRow, latencyMs: number | null): readonly [number, number] {
  const alarmRank = alarmSignal(row).present ? 0 : 1
  const latency = latencyMs ?? Number.POSITIVE_INFINITY
  return [alarmRank, latency] as const
}

export function sortPeerRows<T>(rows: readonly T[], keyOf: (row: T) => readonly [number, number]): T[] {
  return [...rows].sort((a, b) => {
    const [aRank, aLatency] = keyOf(a)
    const [bRank, bLatency] = keyOf(b)
    return aRank - bRank || aLatency - bLatency
  })
}

export const SELF_REPORTED_NOTE = 'self-reported — not independently attested'

// ---------------------------------------------------------------------------
// Witness -- no pane exposes a peer-scoped witness registration count today
// (`history.mine_for_reference.witnessed` is THIS node's OWN chain, carried
// for reference only, never the peer's -- see `PaneBHistoryCell`), so this
// states the absence honestly instead of borrowing that field.
// ---------------------------------------------------------------------------

export const WITNESS_COVERAGE_COMPACT_TEXT = 'not available'

// ---------------------------------------------------------------------------
// Period -- the first/last exchange dates this row spans. `—` when there is
// no exchange history to bound (the "advertised but unused" group).
// ---------------------------------------------------------------------------

function periodDateParts(iso: string): { day: number; month: string; year: number } {
  const parsed = new Date(iso)
  return {
    day: parsed.getUTCDate(),
    month: parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
    year: parsed.getUTCFullYear()
  }
}

export function periodRangeText(firstSeen: string | null, lastSeen: string | null): string {
  if (!firstSeen || !lastSeen) return '—'
  const first = periodDateParts(firstSeen)
  const last = periodDateParts(lastSeen)
  if (first.year === last.year && first.month === last.month) {
    return first.day === last.day ? `${first.day} ${first.month}` : `${first.day}–${last.day} ${first.month}`
  }
  if (first.year === last.year) {
    return `${first.day} ${first.month} – ${last.day} ${last.month}`
  }
  return `${first.day} ${first.month} ${first.year} – ${last.day} ${last.month} ${last.year}`
}

// ---------------------------------------------------------------------------
// Unified row view -- one shape for both row groups ("dealt with" rows
// carry the full Pane B row; "advertised but unused" rows have no exchange
// history at all, so every accountability column degrades to the honest
// "—" placeholder rather than a fabricated zero-of-zero).
//
// [a18-evidence-peers-dedup-network] Accountability-only: no online status,
// latency, or route-to-chat field here (Network's job) -- see
// `PeerTableRow.tsx`.
// ---------------------------------------------------------------------------

export type PeerTableRowView = {
  key: string
  displayId: string
  hasDealings: boolean
  /** One honesty caveat under the identity, stated once (chooser-v2 §3
   *  discipline carried over): `SELF_REPORTED_NOTE` for a dealt-with peer,
   *  "no exchanges yet" for one only advertised. */
  identityNote: string
  exchangeCount: number
  confirmedByOtherSide: string
  match: string
  adjudicationCompact: string
  witnessCompact: string
  period: string
  alarm: AlarmSignal
  row: PaneBRow | null
}

export function dealtWithRowView(
  row: PaneBRow,
  resolveTimestamp?: (capsuleId: string) => string | null
): PeerTableRowView {
  // `peerDisplayId` returns `null` for a row with no counterparty identity
  // at all (see its own doc comment) -- callers filter those out before
  // reaching here, but this fallback keeps the view honest, never `null`,
  // if ever called directly with one.
  const displayId = peerDisplayId(row) ?? 'counterparty not recorded'
  return {
    key: row.peer_id ?? displayId,
    displayId,
    hasDealings: true,
    identityNote: SELF_REPORTED_NOTE,
    exchangeCount: row.exchange_count ?? 0,
    confirmedByOtherSide: confirmedByOtherSideText(confirmedByOtherSide(row)),
    match: matchTallyText(matchTally(row)),
    adjudicationCompact: adjudicationCompactText(adjudicationSummary(row)),
    witnessCompact: WITNESS_COVERAGE_COMPACT_TEXT,
    period: periodRangeText(row.first_seen, row.last_seen),
    alarm: alarmSignal(row, resolveTimestamp),
    row
  }
}

/** "Nodes advertised but unused" -- a peer the mesh knows about but this
 *  node has never exchanged with. Every accountability column renders `—`
 *  (nothing to report, not "0 of 0") -- there is no `PaneBRow` to derive
 *  one from. */
// ---------------------------------------------------------------------------
// Column keys -- shared between `PeerTableRow` and `LedgerPeersTable`'s
// Columns toggle. Lives here (a non-component module) rather than in either
// component file so exporting it never trips the fast-refresh
// only-export-components lint rule.
// ---------------------------------------------------------------------------

export type PeerTableColumnKey = 'exchanges' | 'confirmed' | 'match' | 'adjudication' | 'witness' | 'period'

export const ALL_PEER_TABLE_COLUMNS: ReadonlySet<PeerTableColumnKey> = new Set<PeerTableColumnKey>([
  'exchanges',
  'confirmed',
  'match',
  'adjudication',
  'witness',
  'period'
])

export function advertisedOnlyRowView(displayId: string): PeerTableRowView {
  return {
    key: displayId,
    displayId,
    hasDealings: false,
    identityNote: 'no exchanges yet',
    exchangeCount: 0,
    confirmedByOtherSide: '—',
    match: '—',
    adjudicationCompact: '—',
    witnessCompact: '—',
    period: '—',
    alarm: { present: false, text: '', tone: 'warn' },
    row: null
  }
}
