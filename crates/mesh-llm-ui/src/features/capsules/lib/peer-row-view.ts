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

export function peerDisplayId(row: PaneBRow): string {
  return row.peer_id ?? row.node?.peer_id ?? 'unknown peer'
}

/** Shared by the collapsed row (`PeerCard`) and the modal's Overview tab
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
