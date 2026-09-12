// Windowed paging over the two-sided Ledger stream ([mesh-ledger-b3-paging],
// v3 §2a). Pure, so the "twin brackets never split" invariant is
// unit-testable today even though nothing in the current payload produces a
// bracket bigger than one row yet (that lands in a later batch).
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import type { RailSegment } from '@/features/capsules/lib/exchange-stream'

export const LEDGER_PAGE_SIZE = 50

/** Stable DOM id for a row -- used by the keyboard/deep-link handlers in
 *  `LedgerPage.tsx` to scroll a row into view without ref plumbing. */
export function exchangeRowDomId(exchangeKey: string): string {
  return `exchange-row-${exchangeKey}`
}

export type ExchangeRowGroup = {
  /** Stable identity for the group -- today always the sole row's
   *  exchangeKey. A real multi-row twin bracket (B6) would key on the
   *  bracket id instead, but the packing logic below doesn't care what the
   *  key means, only that a group is atomic. */
  groupKey: string
  rows: readonly ExchangeLedgerRow[]
}

/**
 * Every stream row is its own atomic group until twin-bracket data exists
 * to group by (v3 §2a "twin brackets never split") -- there is nothing to
 * bracket yet, so every group here has exactly one row.
 */
export function groupStreamRows(rows: readonly ExchangeLedgerRow[]): ExchangeRowGroup[] {
  return rows.map((row) => ({ groupKey: row.exchangeKey, rows: [row] }))
}

/**
 * Packs groups into pages of at most `pageSize` rows, never splitting a
 * group across a page boundary. A group larger than `pageSize` still gets a
 * whole page to itself (oversized) rather than being split -- splitting a
 * twin bracket would let a reader see one half and draw the wrong
 * conclusion (v3 §2a "twin brackets never split").
 */
export function paginateGroups(groups: readonly ExchangeRowGroup[], pageSize: number): ExchangeRowGroup[][] {
  const pages: ExchangeRowGroup[][] = []
  let currentPage: ExchangeRowGroup[] = []
  let currentCount = 0
  for (const group of groups) {
    if (currentCount > 0 && currentCount + group.rows.length > pageSize) {
      pages.push(currentPage)
      currentPage = []
      currentCount = 0
    }
    currentPage.push(group)
    currentCount += group.rows.length
  }
  if (currentPage.length > 0) pages.push(currentPage)
  return pages
}

export function flattenPage(page: readonly ExchangeRowGroup[]): ExchangeLedgerRow[] {
  return page.flatMap((group) => group.rows)
}

/** 0-based index of the page containing `groupKey`, or null when it isn't
 *  in any page (e.g. filtered out of the current view). */
export function pageIndexForGroupKey(pages: readonly ExchangeRowGroup[][], groupKey: string): number | null {
  const index = pages.findIndex((page) => page.some((group) => group.groupKey === groupKey))
  return index === -1 ? null : index
}

/** The row-index range `[start, end)` a page occupies in the flattened
 *  (filtered, time-ordered) stream -- used to slice the full-stream rail
 *  segments so cross-page continuity (L-N/L-O) can be detected per page. */
export function pageRowRange(pages: readonly ExchangeRowGroup[][], pageIndex: number): { start: number; end: number } {
  let start = 0
  for (let i = 0; i < pageIndex; i++) {
    start += pages[i].reduce((sum, group) => sum + group.rows.length, 0)
  }
  const pageSize = (pages[pageIndex] ?? []).reduce((sum, group) => sum + group.rows.length, 0)
  return { start, end: start + pageSize }
}

export type PageBoundaryContinuity = {
  /** The first row of this page carries a rail that started on the
   *  PREVIOUS page -- render "…session continues" instead of a fresh
   *  "session <id>" label (v3 §2a: "a rail crossing a boundary shows
   *  '…session continues' at the break on both pages"). */
  continuesFromPreviousPage: boolean
  /** The last row of this page carries a rail that continues onto the
   *  NEXT page. */
  continuesToNextPage: boolean
}

/**
 * `railSegments` must be built over the FULL (filtered, time-ordered)
 * stream, not just the current page -- otherwise every page's first row
 * looks like a segment start and the continuation can never be detected.
 */
export function pageBoundaryContinuity(
  railSegments: readonly RailSegment[],
  pageStart: number,
  pageEnd: number
): PageBoundaryContinuity {
  const firstOnPage = railSegments[pageStart]
  const continuesFromPreviousPage = pageStart > 0 && firstOnPage?.hasRail === true && !firstOnPage.isSegmentStart

  const lastOnPage = railSegments[pageEnd - 1]
  const firstOnNextPage = railSegments[pageEnd]
  const continuesToNextPage =
    lastOnPage?.hasRail === true && firstOnNextPage?.hasRail === true && !firstOnNextPage.isSegmentStart

  return { continuesFromPreviousPage, continuesToNextPage }
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function formatShortDate(isoTimestamp: string): string | null {
  const date = new Date(isoTimestamp)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()]}`
}

/**
 * NORMATIVE — L-K. "The view states its own boundary, and every count above
 * the table states the range it covers." `allRows` must be every row the
 * banner's total count was computed from (the full filtered set), never
 * just the current page -- passing a page here would silently mislabel a
 * page's span as the full range.
 */
export function fullRangeLabel(allRows: readonly ExchangeLedgerRow[]): string | null {
  const timestamps = allRows.map((row) => row.timestamp).filter((value): value is string => value !== null)
  if (timestamps.length === 0) return null
  const sorted = [...timestamps].sort()
  const oldest = formatShortDate(sorted[0])
  const newest = formatShortDate(sorted[sorted.length - 1])
  if (!oldest || !newest) return null
  return oldest === newest ? oldest : `${oldest} – ${newest}`
}

/**
 * NORMATIVE — L-K. The bounded-window banner headline: "Showing 50 of 1,284
 * exchanges · 3 Sep – 11 Sep". `rangeLabel` is appended whenever available
 * rather than only sometimes, so the full-range count is never shown
 * without stating the range it covers; when no row carries a timestamp
 * (`rangeLabel` is null) the count still renders honestly, just without a
 * fabricated range suffix.
 */
export function windowBannerHeadline(rowsOnPage: number, totalRows: number, rangeLabel: string | null): string {
  const noun = totalRows === 1 ? 'exchange' : 'exchanges'
  const base = `Showing ${rowsOnPage} of ${totalRows.toLocaleString('en-US')} ${noun}`
  return rangeLabel ? `${base} · ${rangeLabel}` : base
}
