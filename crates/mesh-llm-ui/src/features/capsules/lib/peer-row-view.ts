// Pure view-model derivation for a Pane B row ([mesh-ledger-peers-tab]).
// Kept separate from the rendering components so the honesty-backbone
// invariants (denominators always present, NOT_CHECKED never summarized as
// corroborated, with-you and their-chain never summed) are unit-testable
// without mounting a component.
import { LatencySource } from '@/lib/api/types'
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

/** Shared by the table row (`PeerTableRow`) and the modal's Overview tab
 *  (`PeerInspector`) so the two never drift into different wording for the
 *  same mesh-status facts. */
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

// ---------------------------------------------------------------------------
// [ledger-T7-peers-table] Block A/B/C view-model (chooser-v2 §3). Rendered
// by the table row, never blended into one paragraph -- see
// `LedgerPeersTable.tsx`.
// ---------------------------------------------------------------------------

/** `rung_cell.rung`'s raw ladder values are internal identifiers -- humanize
 *  for display, and NEVER render the literal word "rung" (ledger grep
 *  gate). */
function humanizeToken(token: string): string {
  return token.replace(/_/g, ' ')
}

export function admissionStateLabel(row: PaneBRow): string | null {
  const value = row.rung?.rung
  return typeof value === 'string' && value.length > 0 ? humanizeToken(value) : null
}

/** Block A's one line: model/quant/context (`meshMetaLine`) plus the
 *  admission state, both self-reported. The "self-reported" note itself
 *  (`SELF_REPORTED_NOTE`) is rendered once by the caller, never repeated
 *  per field -- chooser-v2 §3: "self-reported" stated once. */
export function blockAAnnouncementLine(
  meshStatus: PeerMeshStatus | null,
  admissionState: string | null
): string | null {
  const parts = [meshMetaLine(meshStatus), admissionState].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

export const SELF_REPORTED_NOTE = 'self-reported — not independently attested'

// ---------------------------------------------------------------------------
// Block B — what you have: latency with provenance, answered-when-asked as
// a presence fact (never a rate).
// ---------------------------------------------------------------------------

export function latencyWithProvenanceText(meshStatus: PeerMeshStatus | null): string {
  if (meshStatus?.latencyMs == null) return 'latency unknown'
  const base = `${meshStatus.latencyMs} ms`
  switch (meshStatus.latencySource) {
    case LatencySource.DIRECT:
      return `${base} (you measured)`
    case LatencySource.ESTIMATED:
      return `${base} (reported by another node)`
    default:
      return base
  }
}

/** `asked_cell.text` is already an honest presence/absence fact about
 *  evidence requests THIS node sent this peer (e.g. "this node doesn't
 *  persist a send log yet") -- surface it verbatim under the
 *  "answered when asked" heading rather than deriving a rate from it. */
export function answeredWhenAskedText(row: PaneBRow): string {
  return row.asked?.text ?? 'Answered when asked: not available yet.'
}

// ---------------------------------------------------------------------------
// Block C — what anyone can check: adjudication outcomes (denominator-
// honest, `adjudicationSummaryText` above) plus witness coverage. No pane
// exposes a peer-scoped witness registration count today --
// `history.mine_for_reference.witnessed` is documented as THIS node's OWN
// chain, carried for reference only, never the peer's (see
// `PaneBHistoryCell`) -- so this states the absence honestly instead of
// borrowing that field.
// ---------------------------------------------------------------------------

export const WITNESS_COVERAGE_UNAVAILABLE_TEXT = 'Witness coverage: not available for this peer yet.'

// ---------------------------------------------------------------------------
// Unified row view -- one shape for both row groups ("dealt with" rows
// carry the full Pane B row; "advertised but unused" rows have no
// exchange history at all, so blocks B/C degrade to their honest empty
// state rather than a fabricated zero).
// ---------------------------------------------------------------------------

export type PeerStatusValue = 'online' | 'offline' | 'unknown'

export type PeerTableRowView = {
  key: string
  displayId: string
  online: boolean
  statusValue: PeerStatusValue
  blockA: string | null
  blockBCounts: string
  blockBLatency: string
  blockBAnswered: string | null
  blockCAdjudication: string
  blockCWitness: string
  alarm: AlarmSignal
  canRouteToChat: boolean
  routeDisabledReason: string | null
  hasDealings: boolean
  row: PaneBRow | null
}

export const ROUTE_DISABLED_REASON = 'No mesh status available for this peer yet.'

function statusValueFor(meshStatus: PeerMeshStatus | null): PeerStatusValue {
  if (!meshStatus) return 'unknown'
  return meshStatus.online ? 'online' : 'offline'
}

const ZERO_ADJUDICATION: AdjudicationSummary = {
  checked: 0,
  denominator: 0,
  corroborated: 0,
  contradicted: 0,
  inconclusive: 0,
  notChecked: true
}

export function dealtWithRowView(
  row: PaneBRow,
  meshStatus: PeerMeshStatus | null,
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
    online: meshStatus?.online ?? false,
    statusValue: statusValueFor(meshStatus),
    blockA: blockAAnnouncementLine(meshStatus, admissionStateLabel(row)),
    blockBCounts: withYouCountsText(withYouCounts(row)),
    blockBLatency: latencyWithProvenanceText(meshStatus),
    blockBAnswered: answeredWhenAskedText(row),
    blockCAdjudication: adjudicationSummaryText(adjudicationSummary(row)),
    blockCWitness: WITNESS_COVERAGE_UNAVAILABLE_TEXT,
    alarm: alarmSignal(row, resolveTimestamp),
    canRouteToChat: Boolean(meshStatus?.modelName),
    routeDisabledReason: meshStatus?.modelName ? null : ROUTE_DISABLED_REASON,
    hasDealings: true,
    row
  }
}

/** "Nodes advertised but unused" -- a peer the mesh knows about but this
 *  node has never exchanged with. Block B/C render their honest zero
 *  state (never fabricated) -- `withYouCountsText`/`adjudicationSummaryText`
 *  are not reused here on purpose: there is no `PaneBRow` to derive them
 *  from, and "No exchanges yet" is the accurate statement, not "0 of 0". */
export function advertisedOnlyRowView(displayId: string, meshStatus: PeerMeshStatus | null): PeerTableRowView {
  return {
    key: displayId,
    displayId,
    online: meshStatus?.online ?? false,
    statusValue: statusValueFor(meshStatus),
    blockA: blockAAnnouncementLine(meshStatus, null),
    blockBCounts: 'No exchanges yet',
    blockBLatency: latencyWithProvenanceText(meshStatus),
    blockBAnswered: null,
    blockCAdjudication: adjudicationSummaryText(ZERO_ADJUDICATION),
    blockCWitness: WITNESS_COVERAGE_UNAVAILABLE_TEXT,
    alarm: { present: false, text: '', tone: 'warn' },
    canRouteToChat: Boolean(meshStatus?.modelName),
    routeDisabledReason: meshStatus?.modelName ? null : ROUTE_DISABLED_REASON,
    hasDealings: false,
    row: null
  }
}
