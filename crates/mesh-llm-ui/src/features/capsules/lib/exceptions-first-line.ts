// The Exchanges header's exceptions-first line ([ledger-T8-header-copy]) --
// leads with what needs attention, never a flat "N exchanges" count that
// buries a failure below it. Kept pure/testable, matching the discipline
// `checksTextFor` (exchange-ledger.ts) already uses for the row-level
// Checks column: NEVER a count when clean (em-dash there; "Nothing needs
// your attention" here), the specific failing tally when not.
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'

export type ExceptionsFirstTally = {
  total: number
  /** Rows carrying at least one of the three exceptions below -- a row
   *  counted once here even if it trips more than one category, so this
   *  never overstates how many records actually need a look. */
  needingAttention: number
  /** A property/pair-reconciliation check literally failed its recompute
   *  (`row.hasIssue`) -- see `checksTextFor`. */
  failed: number
  /** Both sides hold a signed record and they disagree
   *  (`rightCellState.kind === 'contradicted'`). */
  mismatched: number
  /** Asked for their half; no reply yet (`rightCellState.kind ===
   *  'open_asked'`) -- distinct from never having asked at all. */
  askedUnanswered: number
}

export function exceptionsFirstTally(rows: readonly ExchangeLedgerRow[]): ExceptionsFirstTally {
  let failed = 0
  let mismatched = 0
  let askedUnanswered = 0
  let needingAttention = 0

  for (const row of rows) {
    const isFailed = row.hasIssue
    const isMismatched = row.rightCellState.kind === 'contradicted'
    const isAskedUnanswered = row.rightCellState.kind === 'open_asked'
    if (isFailed) failed += 1
    if (isMismatched) mismatched += 1
    if (isAskedUnanswered) askedUnanswered += 1
    if (isFailed || isMismatched || isAskedUnanswered) needingAttention += 1
  }

  return { total: rows.length, needingAttention, failed, mismatched, askedUnanswered }
}

/** NORMATIVE — same range discipline as `windowBannerHeadline`/
 *  `fullRangeLabel` (exchange-pages.ts, L-K): every count above the table
 *  states the range it covers, appended only when a row actually carries a
 *  timestamp, never fabricated. */
export function exceptionsFirstLine(tally: ExceptionsFirstTally, rangeLabel: string | null): string {
  const { total, needingAttention, failed, mismatched, askedUnanswered } = tally
  const noun = total === 1 ? 'exchange' : 'exchanges'
  const rangeSuffix = rangeLabel ? `, ${rangeLabel}` : ''
  const breakdown = `${failed} failed · ${mismatched} mismatched · ${askedUnanswered} asked-and-unanswered`

  if (needingAttention === 0) {
    return `Nothing needs your attention. ${total} ${noun}${rangeSuffix}, all sealed, all recomputed clean. ${breakdown}.`
  }

  const needNoun = needingAttention === 1 ? 'exchange needs' : 'exchanges need'
  return `${needingAttention} ${needNoun} your attention — ${total} ${noun}${rangeSuffix}. ${breakdown}.`
}
