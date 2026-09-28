// [mesh-chat-evidence-chip] UX review rev 2 §7.6 (1): the join from a Chat
// turn (or a Logs row) to its Evidence row, and the one-line chip a Chat turn
// shows for it.
//
// The Evidence row key is the host's `exchange_key_for` (`capsule_panes_
// native.rs`): `digest:<effect.request_digest>`, falling back to
// `serving_provenance.exchange_id` only when a record carries no request
// digest. Neither side ever sees that key directly; each reaches it through a
// sealed record this node holds:
//   - Chat: the `x-capsule-client-nonce` the serving frontend echoes on the
//     response. On a turn this node sent to a peer, the same nonce is sealed
//     into our requester record as `client_nonce`. A turn this node served
//     itself seals no nonce, so it finds no record and shows no chip.
//   - Logs: the frontend's exchange id, which Logs records on a non-streaming
//     request and the host-served path seals at `serving_provenance.
//     exchange_id` (`openai_exchange.rs`).
// No match, or more than one row matching -> no key -> nothing rendered.
// Nothing is guessed from timing or model name.
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import {
  askForRecordIsDue,
  deriveRightCellState,
  type RightCellStateKind
} from '@/features/capsules/lib/exchange-row-state'
import { CHAT_EVIDENCE_CHIP_TOOLTIPS } from '@/features/capsules/lib/tooltip-copy'

type JsonObject = Record<string, unknown>

function objectAt(value: unknown, path: readonly string[]): JsonObject | null {
  let cursor: unknown = value
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null
    cursor = (cursor as JsonObject)[key]
  }
  return typeof cursor === 'object' && cursor !== null ? (cursor as JsonObject) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function pocBlock(record: unknown): JsonObject | null {
  return objectAt(record, ['model_attestation', 'compute_attestation', 'x-mesh-poc-v1'])
}

function recordExchangeId(record: unknown): string | null {
  const id = nonEmptyString(objectAt(pocBlock(record), ['serving_provenance'])?.['exchange_id'])
  return id && id !== 'unknown' ? id : null
}

function recordClientNonce(record: unknown): string | null {
  return nonEmptyString(pocBlock(record)?.['client_nonce'])
}

/** Follows the host's `exchange_key_for` rule for rule: any string
 *  `effect.request_digest` (even empty, as the host does), else a non-empty,
 *  non-`unknown` `serving_provenance.exchange_id`. */
export function recordExchangeKey(record: unknown): string | null {
  const digest = objectAt(record, ['effect'])?.['request_digest']
  if (typeof digest === 'string') return `digest:${digest}`
  return recordExchangeId(record)
}

/** Every record body the page holds: this node's ledger, plus the bodies the
 *  pane sent on each row (ours and a pushed one of theirs). */
function candidateRecords(rows: readonly PaneCRow[], records: readonly CapsuleRecord[]): unknown[] {
  return [...records, ...rows.flatMap((row) => [row.mine.record, row.theirs.record].filter(Boolean))]
}

function rowKeyForRecord(rows: readonly PaneCRow[], record: unknown): string | null {
  const key = recordExchangeKey(record)
  return key && rows.some((row) => row.exchange_key === key) ? key : null
}

/** The one row key the matching records share, or `null` when none match
 *  or they point at different rows (ambiguous: say nothing). */
function soleRowKey(rows: readonly PaneCRow[], matches: readonly unknown[]): string | null {
  const keys = new Set(matches.map((record) => rowKeyForRecord(rows, record)))
  if (keys.size !== 1) return null
  const [key] = keys
  return key ?? null
}

/** The chip for a Chat turn, or `null` when no single row is found for it. */
export function chatEvidenceChipForTurn(
  clientNonce: string,
  rows: readonly PaneCRow[],
  records: readonly CapsuleRecord[]
): { rowKey: string; chip: ChatEvidenceChip } | null {
  const rowKey = evidenceRowKeyForChat(clientNonce, rows, records)
  const row = rowKey ? rows.find((candidate) => candidate.exchange_key === rowKey) : undefined
  const chip = row ? chatEvidenceChip(row) : null
  return rowKey && chip ? { rowKey, chip } : null
}

/** The Evidence row a Chat turn belongs to, found by the client nonce sealed
 *  into this node's requester record. */
export function evidenceRowKeyForChat(
  clientNonce: string,
  rows: readonly PaneCRow[],
  records: readonly CapsuleRecord[]
): string | null {
  return soleRowKey(
    rows,
    candidateRecords(rows, records).filter((record) => recordClientNonce(record) === clientNonce)
  )
}

/** Resolves a deep-link key to an Evidence row key. Accepts a row key as-is,
 *  or the exchange id Logs carries, resolved through the sealed record that
 *  names it. `null` when neither matches a row. */
export function evidenceRowKeyForLink(
  key: string,
  rows: readonly PaneCRow[],
  records: readonly CapsuleRecord[]
): string | null {
  if (rows.some((row) => row.exchange_key === key)) return key
  return soleRowKey(
    rows,
    candidateRecords(rows, records).filter((candidate) => recordExchangeId(candidate) === key)
  )
}

export type ChatEvidenceChipKind = 'confirmed' | 'awaiting' | 'differs' | 'declined' | 'they_have_none'

export type ChatEvidenceChip = {
  readonly kind: ChatEvidenceChipKind
  readonly label: string
  readonly tooltip: string
}

const CHIP_LABELS: Record<ChatEvidenceChipKind, string> = {
  confirmed: 'sealed ✓ · confirmed by the other side',
  awaiting: 'sealed · their record not received yet',
  differs: 'sealed · their record differs',
  declined: 'sealed · they declined to share their record',
  they_have_none: 'sealed · they say they have no record'
}

/** One chip per row state, worded as the row's own sentence
 *  (`rightCellText`) says it: `open_not_held` and `open_not_given` are both
 *  "hasn't arrived yet" there, and so here. */
function chipKind(state: RightCellStateKind): ChatEvidenceChipKind {
  switch (state) {
    case 'closed':
      return 'confirmed'
    case 'contradicted':
      return 'differs'
    case 'open_refused':
      return 'declined'
    case 'open_absent':
      return 'they_have_none'
    // In Chat, the design's second variant (§7.6-1): their record usually
    // arrives on its own, so "not asked for" is the tab's word, not Chat's.
    case 'open_not_asked':
    case 'open_asked':
    case 'open_not_held':
    case 'open_not_given':
      return 'awaiting'
    default: {
      const exhaustiveCheck: never = state
      return exhaustiveCheck
    }
  }
}

/** The chip for one Evidence row, from the Evidence tab's one gate
 *  (`deriveRightCellState`) over the evidence the pane holds -- the same input
 *  the tab's headline counts use. A fetch the reader runs from the row's own
 *  checks panel lives in that row's state and is not seen here, so the chip can
 *  lag it (reading not-received while the row reads CLOSED), never lead it.
 *  `null` when this node holds no sealed record of its own for the row. */
export function chatEvidenceChip(row: PaneCRow): ChatEvidenceChip | null {
  if (row.mine.state === 'absent') return null
  const kind = chipKind(deriveRightCellState(row).kind)
  return { kind, label: CHIP_LABELS[kind], tooltip: CHAT_EVIDENCE_CHIP_TOOLTIPS[kind] }
}

/** How often a Chat turn's chip re-reads Evidence, or `false` to stop:
 *  only while something can still arrive on its own (our record not sealed
 *  yet, or theirs not in yet), and only inside the window the Evidence row
 *  itself waits before offering to ask (`askForRecordIsDue`). */
export function chatEvidencePollMs(
  found: { chip: ChatEvidenceChip } | null,
  turnTimestamp: string,
  nowMs: number
): number | false {
  if (askForRecordIsDue(turnTimestamp, nowMs)) return false
  return !found || found.chip.kind === 'awaiting' ? CHAT_EVIDENCE_POLL_MS : false
}

export const CHAT_EVIDENCE_POLL_MS = 15_000
