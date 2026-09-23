// The two-sided Ledger row's right-cell state ([mesh-ledger-b2-two-sided-
// row]). Seven states -- v3 §2's table enumerates six ("closed"/
// "contradicted"/refused/absent/asked/not-asked), plus `open_pending_fetch`
// added by [mesh-console-evidence-tab-honesty-defects] finding 1: a
// peer-asserted capsule id with no bytes fetched yet is its own honest
// state, not a fast path into `closed`.
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { PeerRecomputeState } from '@/features/capsules/lib/recompute-identity'

export type RightCellStateKind =
  | 'closed' // artifact, agrees
  | 'contradicted' // artifact, disagrees
  | 'open_refused' // signed_refusal
  | 'open_absent' // recorded_absence
  | 'open_asked' // unanswered
  | 'open_pending_fetch' // peer id known, bytes not fetched
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
 * Derives the right-cell state from a Pane C row and, when this browser has
 * actually gone and fetched the peer's half, that fetch's outcome.
 *
 * If the row already carries `theirs.evidence_outcome` (one of the four
 * evidence-request outcomes named above), that value wins outright.
 *
 * **Finding 1 (2026-09-23 assessment): CLOSED requires a held artifact, not
 * a peer-asserted id.** `theirs.state === 'NOT_CHECKED'` (the only
 * non-absent state `theirs_cell` -- `capsule_panes_native.rs` -- emits)
 * means a peer-asserted `capsule_id` is on the record and is fetchable, and
 * nothing more: no bytes are held, nothing has been checked. Reading that
 * alone as "artifact, agrees" rendered ~110 of 135 live rows CLOSED with
 * zero corroboration ever performed -- the one claim this tab exists to
 * make ("we both say so"), true when it was false. CLOSED/CONTRADICTED are
 * now reachable only via `theirsRecompute`, the record of an ACTUAL
 * `mesh_ledger_fetch` this browser ran (`recompute-identity.ts`):
 *   - `status === 'found'` and `idMatch === true` (the peer's bytes,
 *     independently recomputed here, produce the exact `capsule_id` they
 *     asserted, and the signature over them verifies) -> CLOSED. This
 *     verifies the fetched artifact is authentic and unmodified; it does
 *     not yet cross-check every one of its properties against `mine`'s
 *     value (`security-checks-view.ts`'s `buildCommitsToRows` does that
 *     per-field once `peerRecord` is held) -- an honest, narrower claim
 *     than the six-state table's "cites your half by digest" until that
 *     cross-reference is wired.
 *   - `status === 'found'` and `idMatch === false` -> CONTRADICTED: the
 *     peer's own bytes don't produce the id they claimed for them.
 *   - anything else (not fetched, fetching, not_found, error, or a fetch
 *     whose id recompute itself couldn't run) leaves the row at
 *     `open_pending_fetch` below -- a fetch that hasn't resolved to a
 *     definite match/mismatch is not evidence of either.
 *
 * With no evidence_outcome and no confirmed fetch, `theirs.state`
 * distinguishes only two real facts -- **L-C: the right cell never renders
 * a state we inferred.**
 *   - `NOT_CHECKED`: a peer-asserted id is known and fetchable but nothing
 *     has confirmed it yet -> `open_pending_fetch`.
 *   - `absent`: no counterparty is recorded for this row at all -> the only
 *     claim this supports is `open_not_asked` ("you haven't asked for
 *     their half") -- `open_asked`/`open_refused`/`open_absent` would all
 *     require a signed statement or ask-log this row carries none of.
 */
export function deriveRightCellState(row: PaneCRow, theirsRecompute?: PeerRecomputeState): RightCellState {
  const outcome = row.theirs.evidence_outcome
  const mappedKind = outcome ? EVIDENCE_OUTCOME_TO_KIND[outcome] : undefined
  if (mappedKind) {
    return { kind: mappedKind, date: row.theirs.evidence_outcome_date ?? null }
  }

  // `theirs.state === 'absent'` means no counterparty is recorded for this
  // row at all -- structurally, `peerFetchJoinKey` (`recompute-identity.
  // ts`) never produces a join key for such a row, so no real fetch could
  // have happened against it. Checked before `theirsRecompute` so this fact
  // always wins, even over a `theirsRecompute` object a caller passed in
  // that no longer matches this row (a stale prop during a re-render, a
  // test double) -- the row's own recorded state is the ground truth.
  if (row.theirs.state === 'absent') {
    return { kind: 'open_not_asked', date: null }
  }

  if (theirsRecompute?.status === 'found' && theirsRecompute.idMatch !== null) {
    return { kind: theirsRecompute.idMatch ? 'closed' : 'contradicted', date: null }
  }

  return { kind: 'open_pending_fetch', date: null }
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
    case 'open_pending_fetch':
      return 'A peer capsule is known but not fetched — expand checks to fetch it.'
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
    case 'open_pending_fetch':
      return 'OPEN · pending fetch'
    case 'open_not_asked':
      return 'OPEN'
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}

/** The action control that lives inside the cell, or `null` for `closed`
 *  (nothing to do once a row agrees and cites your half) and
 *  `open_pending_fetch` (the real action -- `fetch peer capsule &
 *  recompute here` -- lives inside the `▸ checks` panel, next to the
 *  identity it fetches for, not as a second copy of the same button at the
 *  row summary level). */
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
    case 'open_pending_fetch':
      return null
    case 'open_not_asked':
      return 'Ask them for their half'
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}

/** The two states whose action is literally "ask a counterparty"
 *  ([ledger-T1-ask-half-action]) -- every other action (`Compare` / `View
 *  refusal` / `View statement`) inspects evidence this node already holds,
 *  not a live counterparty to contact, so only these two require a
 *  recorded counterparty before the action can render. */
const ASK_ACTION_KINDS: ReadonlySet<RightCellStateKind> = new Set(['open_not_asked', 'open_asked'])

export function isAskAction(kind: RightCellStateKind): boolean {
  return ASK_ACTION_KINDS.has(kind)
}

/** L-B: "Only CONTRADICTED gets alarm styling. It is the one state where
 *  two signed records disagree. Everything else is a presence fact." This
 *  predicate is also what enforces L-A ("an open row is never styled as a
 *  problem") -- every OPEN kind returns `false` here, same as `closed`. */
export function isAlarmState(state: RightCellState): boolean {
  return state.kind === 'contradicted'
}

/** The ledger's state toolbar filter values (v3 §2a: "useful filters are
 *  states, not qualities: open / closed / contradicted / asked-no-reply /
 *  twins only"). `twins` isn't a right-cell state at all -- it's whether a
 *  row belongs to a twin bracket, which callers derive separately (see
 *  `exchange-pages.ts`; no bracket data exists until B6). */
export type LedgerStateFilterValue = 'open' | 'closed' | 'contradicted' | 'asked_no_reply'

export const LEDGER_STATE_FILTER_VALUES: readonly LedgerStateFilterValue[] = [
  'closed',
  'contradicted',
  'asked_no_reply',
  'open'
]

/** Buckets the seven right-cell states into the toolbar's state filter
 *  values: `open_asked` (a real ask, no reply yet) gets its own
 *  `asked_no_reply` bucket, and the four "we hold no reply/no fetch at all"
 *  states collapse into the broader `open` bucket. */
export function ledgerStateFilterValue(state: RightCellState): LedgerStateFilterValue {
  switch (state.kind) {
    case 'closed':
      return 'closed'
    case 'contradicted':
      return 'contradicted'
    case 'open_asked':
      return 'asked_no_reply'
    case 'open_refused':
    case 'open_absent':
    case 'open_pending_fetch':
    case 'open_not_asked':
      return 'open'
    default: {
      const exhaustiveCheck: never = state.kind
      return exhaustiveCheck
    }
  }
}
