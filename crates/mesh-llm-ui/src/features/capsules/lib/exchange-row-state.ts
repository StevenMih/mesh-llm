// The two-sided Ledger row's right-cell state ([mesh-ledger-b2-two-sided-
// row]). Six states per v3 §2's table -- the table is authoritative over
// its own "four right-cell states" heading (the batch spec flags that
// heading as stale; the table it introduces enumerates six, and all six are
// implemented here).
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'

export type RightCellStateKind =
  | 'closed' // artifact, agrees
  | 'contradicted' // artifact, disagrees
  | 'open_refused' // signed_refusal
  | 'open_absent' // recorded_absence
  | 'open_asked' // unanswered
  | 'open_not_asked' // not asked

export type RightCellState = {
  kind: RightCellStateKind
  /** The date carried by the underlying signed statement/ask, when the row
   *  data actually carries one -- never invented when it doesn't. */
  date: string | null
}

// Wire vocabulary from v3 §2's "evidence" column. The evidence-request
// carrier that would populate this is still unwired end-to-end as of this
// batch (capsule-emit-mesh's `evidence_responder.py` docstring: "Carrier
// wiring is out of scope here ... not yet reachable over the wire") -- this
// mapping exists so the UI is forward-compatible the moment it is.
const EVIDENCE_OUTCOME_TO_KIND: Record<string, RightCellStateKind> = {
  signed_refusal: 'open_refused',
  recorded_absence: 'open_absent',
  unanswered: 'open_asked',
  not_asked: 'open_not_asked'
}

/**
 * Derives the right-cell state from a Pane C row.
 *
 * If the row already carries `theirs.evidence_outcome` (one of the four
 * evidence-request outcomes named above), that value wins outright.
 *
 * Otherwise, today's real payload only distinguishes `theirs.state`
 * present/absent -- **L-C: the right cell never renders a state we
 * inferred.** With no ask-log carried on the row, we hold no evidence of
 * ever having asked, so `open_asked` (unanswered) or `open_refused`/
 * `open_absent` (which require a signed statement we don't have) would all
 * be guesses. `open_not_asked` is the only claim the absence of an
 * evidence_outcome actually supports: "you haven't asked for their half" is
 * true precisely when we hold no record of asking.
 */
export function deriveRightCellState(row: PaneCRow): RightCellState {
  const outcome = row.theirs.evidence_outcome
  const mappedKind = outcome ? EVIDENCE_OUTCOME_TO_KIND[outcome] : undefined
  if (mappedKind) {
    return { kind: mappedKind, date: row.theirs.evidence_outcome_date ?? null }
  }

  if (row.theirs.state !== 'absent') {
    const agrees = row.properties?.outcome_corroboration?.state !== 'FAIL'
    return { kind: agrees ? 'closed' : 'contradicted', date: null }
  }

  return { kind: 'open_not_asked', date: null }
}

function dateOrFallback(date: string | null): string {
  return date ?? 'date unavailable'
}

/** The right cell's rendered sentence. Every OPEN variant reads as a
 *  presence fact, never a problem (L-A) -- only `contradicted` names an
 *  alarm word (`differs`). */
export function rightCellText(state: RightCellState): string {
  switch (state.kind) {
    case 'closed':
      return '✓ cites your half by digest'
    case 'contradicted':
      return '⚠ differs'
    case 'open_refused':
      return `They declined, and signed the refusal — ${dateOrFallback(state.date)}`
    case 'open_absent':
      return `They say they have no record of this — ${dateOrFallback(state.date)}`
    case 'open_asked':
      return `Asked ${dateOrFallback(state.date)}. No reply yet.`
    case 'open_not_asked':
      return "You haven't asked for their half."
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}

export function rightCellStatusLabel(state: RightCellState): string {
  switch (state.kind) {
    case 'closed':
      return 'CLOSED'
    case 'contradicted':
      return 'CONTRADICTED'
    case 'open_refused':
      return 'OPEN · refused'
    case 'open_absent':
      return 'OPEN · absent'
    case 'open_asked':
      return 'OPEN · asked'
    case 'open_not_asked':
      return 'OPEN'
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}

/** The action control that lives inside the cell, or `null` for `closed`
 *  (nothing to do once a row agrees and cites your half). */
export function rightCellAction(state: RightCellState): string | null {
  switch (state.kind) {
    case 'closed':
      return null
    case 'contradicted':
      return 'Compare'
    case 'open_refused':
      return 'View refusal'
    case 'open_absent':
      return 'View statement'
    case 'open_asked':
      return 'Ask again'
    case 'open_not_asked':
      return 'Ask them for their half'
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}

/** L-B: "Only CONTRADICTED gets alarm styling. It is the one state where
 *  two signed records disagree. Everything else is a presence fact." This
 *  predicate is also what enforces L-A ("an open row is never styled as a
 *  problem") -- every OPEN kind returns `false` here, same as `closed`. */
export function isAlarmState(state: RightCellState): boolean {
  return state.kind === 'contradicted'
}
