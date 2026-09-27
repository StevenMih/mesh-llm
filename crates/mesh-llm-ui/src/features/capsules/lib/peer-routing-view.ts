// §7.5 "should I stop dealing with anyone?": the drill's routing section. What
// the host's local block store says about one peer, in the words the drill
// shows. The store is this node's alone; nothing here reads anything a peer
// sent.
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import {
  adjudicationSummary,
  confirmedByOtherSide,
  matchTally,
  periodRangeText
} from '@/features/capsules/lib/peer-row-view'
import { ROUTING_BLOCK_COPY } from '@/features/capsules/lib/tooltip-copy'

export type PeerRoutingChoice = {
  change: 'block' | 'unblock'
  peer: string
  at_ms: number
  until_ms?: number | null
  /** The sealed record's id; null when the record could not be sealed. */
  capsule_id: string | null
}

export type PeerBlocksJson = {
  blocks: Record<string, { blocked_at_ms: number; until_ms?: number | null }>
  choices: PeerRoutingChoice[]
}

export type PeerRoutingChangeJson = {
  choice: PeerRoutingChoice
  sealed: boolean
  seal_error?: string
}

export type RoutingState =
  /** The row has no full node id, so there is nothing the router could skip. */
  | { kind: 'no_node_id' }
  | { kind: 'routing'; last: PeerRoutingChoice | null }
  | { kind: 'stopped'; untilMs: number | null; last: PeerRoutingChoice | null }

const NODE_ID = /^[0-9a-f]{64}$/

/** The id the router keys blocks by: the peer's full mesh node id, and only
 *  when your own records name it. A signing key, a short endpoint prefix, or a
 *  node id the peer asserted about itself (it could name an honest node) is
 *  not enough. */
export function routableNodeId(row: PaneBRow): string | null {
  const identity = row.identity
  if (identity?.node_id_source !== 'your_records') return null
  const nodeId = identity.node_id
  return typeof nodeId === 'string' && NODE_ID.test(nodeId) ? nodeId : null
}

/** The host lists only blocks still in force (it drops a lapsed timed block
 *  when it reads the store), so a listed block is a stopped peer. */
export function routingState(nodeId: string | null, blocks: PeerBlocksJson | null | undefined): RoutingState {
  if (nodeId === null) return { kind: 'no_node_id' }
  const last = [...(blocks?.choices ?? [])].reverse().find((choice) => choice.peer === nodeId) ?? null
  const active = blocks?.blocks[nodeId]
  if (active) return { kind: 'stopped', untilMs: active.until_ms ?? null, last }
  return { kind: 'routing', last }
}

/** "4 Oct": the same day-month form as the Peers table's `periodRangeText`. */
function shortDate(ms: number): string {
  return periodRangeText(new Date(ms).toISOString(), new Date(ms).toISOString())
}

export function routingStateText(state: RoutingState): string {
  switch (state.kind) {
    case 'no_node_id':
      return ROUTING_BLOCK_COPY.noNodeId
    case 'routing':
      return state.last?.change === 'unblock'
        ? `You resumed routing to them on ${shortDate(state.last.at_ms)}.`
        : ROUTING_BLOCK_COPY.routing
    case 'stopped':
      return state.untilMs === null
        ? 'Stopped until you undo it, by your choice. Only on your node.'
        : `Stopped until ${shortDate(state.untilMs)}, by your choice. Only on your node.`
  }
}

/** Whether the last block or unblock made it onto your records. */
export function recordText(last: PeerRoutingChoice | null): string | null {
  if (last === null) return null
  const what = last.change === 'block' ? 'The block' : 'The undo'
  return last.capsule_id
    ? `${what} is sealed on your records.`
    : `${what} is not confirmed on your records yet. It still applies.`
}

/** §7.5 "your dealings with them": exchanges, how many they confirmed with
 *  their own record, how many records differ, and disputes judged. Counts
 *  with their denominators; never a single number standing for the peer. */
export function dealingsLines(row: PaneBRow): string[] {
  const confirmed = confirmedByOtherSide(row)
  const tally = matchTally(row)
  const disputes = adjudicationSummary(row)
  const exchanges = row.exchange_count ?? 0
  return [
    `${exchanges} ${exchanges === 1 ? 'exchange' : 'exchanges'} with you · they confirmed ${confirmed.confirmed} of ${confirmed.total}`,
    `Same request & answer: ${tally.clean} · ${tally.mismatch} differ`,
    disputes.notChecked
      ? 'Disputes judged: none'
      : `Disputes judged: ${disputes.checked} of ${disputes.denominator}${disputeParts(disputes)}`
  ]
}

function disputeParts(summary: ReturnType<typeof adjudicationSummary>): string {
  const parts: string[] = []
  if (summary.corroborated) parts.push(`${summary.corroborated} corroborated`)
  if (summary.contradicted) parts.push(`${summary.contradicted} contradicted`)
  if (summary.inconclusive) parts.push(`${summary.inconclusive} inconclusive`)
  return parts.length ? ` · ${parts.join(' · ')}` : ''
}
