// Pure view-model derivation for the Exchanges table
// ([mesh-ledger-phase3-tables-and-modal] Part 3) — kept separate from the
// table/column rendering so the honesty-backbone invariants (Checks is
// exceptions-first and NEVER a count; Confirmed is the double-entry fact,
// not registration) are unit-testable without mounting a table.
import type { PaneBRow, PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { deriveRightCellState, type RightCellState } from '@/features/capsules/lib/exchange-row-state'
import { NINE_PROPERTY_LABELS } from '@/features/capsules/lib/nine-properties'
import { peerExchangeIds } from '@/features/capsules/lib/peer-exchange-timeline'
import { peerDisplayId } from '@/features/capsules/lib/peer-row-view'

export type ExchangeLedgerRow = {
  exchangeKey: string
  timestamp: string | null
  roleTag: string
  counterparty: string | null
  /** The double-entry differentiator (not registration, which is a range
   *  fact that belongs on Integrity, never per-row). */
  confirmed: boolean
  hasIssue: boolean
  /** Exceptions-first, NEVER a count — "—" when clean, else the specific
   *  failing property name(s), or the pair-reconciliation fallback when
   *  `has_issue` is driven by that check rather than a named property. */
  checksText: string
  /** The right cell's one of six states (v3 §2) -- see
   *  `exchange-row-state.ts` for the derivation and its honesty limits. */
  rightCellState: RightCellState
  /** L-O: null for every served row and for any row the record itself
   *  carries no session for -- never invented. */
  sessionId: string | null
  raw: PaneCRow
}

/** Pane C rows carry no counterparty identity field at all (`mine`/
 *  `theirs` are state + capsule_id only) -- the only real, non-invented way
 *  to name a counterparty is the SAME join `livePeerExchangeSources` already
 *  uses in the other direction: a Pane B peer's own `pair.details`/
 *  `expand.pair_ledger` names the exchange_ids it reconciled. This inverts
 *  that lookup into exchange_id -> peer display id, reusing `peerExchangeIds`
 *  verbatim rather than re-deriving the join. */
export function buildExchangeCounterpartyIndex(paneBRows: readonly PaneBRow[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const row of paneBRows) {
    const displayId = peerDisplayId(row)
    for (const exchangeId of peerExchangeIds(row)) {
      index.set(exchangeId, displayId)
    }
  }
  return index
}

function checksTextFor(row: PaneCRow): string {
  if (!row.has_issue) return '—'
  const properties = row.properties ?? {}
  const failing = Object.entries(properties)
    .filter(([, cell]) => cell?.state === 'FAIL')
    .map(([key]) => NINE_PROPERTY_LABELS[key] ?? key.replace(/_/g, ' '))
  // `has_issue` can also be driven by the pair-reconciliation check, which
  // is not one of the nine named properties this row's `properties` object
  // carries -- name that honestly too, never silently blank when there IS
  // an exception to report.
  return failing.length > 0 ? failing.join(', ') : 'pair reconciliation'
}

export function buildExchangeLedgerRows(
  rows: readonly PaneCRow[],
  counterpartyIndex: ReadonlyMap<string, string>
): ExchangeLedgerRow[] {
  return rows.map((row) => ({
    exchangeKey: row.exchange_key,
    timestamp: row.timestamp,
    roleTag: row.role_tag,
    counterparty: counterpartyIndex.get(row.exchange_key) ?? null,
    confirmed: row.theirs.state !== 'absent' && !row.unilateral,
    hasIssue: row.has_issue,
    checksText: checksTextFor(row),
    rightCellState: deriveRightCellState(row),
    // L-O -- a served row structurally has no session (this node was never
    // party to the requester's conversation), regardless of what the
    // record carries.
    sessionId: row.role_tag === 'ASKED' ? (row.session_id ?? null) : null,
    raw: row
  }))
}
