import { describe, expect, it } from 'vitest'
import { exceptionsFirstLine, exceptionsFirstTally } from '@/features/capsules/lib/exceptions-first-line'
import { buildExchangeLedgerRows } from '@/features/capsules/lib/exchange-ledger'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'

function paneCRow(overrides: Partial<PaneCRow>): PaneCRow {
  return {
    exchange_key: 'exch-1',
    role_tag: 'ASKED',
    header_state: 'ok',
    properties: null,
    has_issue: false,
    mine: { state: 'present', capsule_id: 'mine-1' },
    theirs: { state: 'present', capsule_id: 'theirs-1' },
    unilateral: false,
    timestamp: '2026-09-08T00:00:00Z',
    ...overrides
  }
}

const CLEAN_ROW = paneCRow({ exchange_key: 'exch-clean' })
const FAILED_ROW = paneCRow({
  exchange_key: 'exch-failed',
  has_issue: true,
  properties: { content_binding: { state: 'FAIL', text: 'digest mismatch' } }
})
const MISMATCHED_ROW = paneCRow({
  exchange_key: 'exch-mismatched',
  properties: { outcome_corroboration: { state: 'FAIL' } }
})
const ASKED_UNANSWERED_ROW = paneCRow({
  exchange_key: 'exch-asked',
  theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'unanswered', evidence_outcome_date: '2026-09-01' }
})

describe('exceptionsFirstTally', () => {
  it('is all-zero for an empty set', () => {
    expect(exceptionsFirstTally([])).toEqual({
      total: 0,
      needingAttention: 0,
      failed: 0,
      mismatched: 0,
      askedUnanswered: 0
    })
  })

  it('counts a hasIssue row as failed', () => {
    const [row] = buildExchangeLedgerRows([FAILED_ROW], new Map())
    const tally = exceptionsFirstTally([row])
    expect(tally).toEqual({ total: 1, needingAttention: 1, failed: 1, mismatched: 0, askedUnanswered: 0 })
  })

  it('counts a contradicted right-cell state as mismatched, not failed', () => {
    const [row] = buildExchangeLedgerRows([MISMATCHED_ROW], new Map())
    expect(row.hasIssue).toBe(false)
    const tally = exceptionsFirstTally([row])
    expect(tally).toEqual({ total: 1, needingAttention: 1, failed: 0, mismatched: 1, askedUnanswered: 0 })
  })

  it('counts an open_asked right-cell state as asked-and-unanswered', () => {
    const [row] = buildExchangeLedgerRows([ASKED_UNANSWERED_ROW], new Map())
    const tally = exceptionsFirstTally([row])
    expect(tally).toEqual({ total: 1, needingAttention: 1, failed: 0, mismatched: 0, askedUnanswered: 1 })
  })

  it('never double-counts one row across needingAttention when it trips more than one category', () => {
    const bothRow = paneCRow({
      exchange_key: 'exch-both',
      has_issue: true,
      properties: { content_binding: { state: 'FAIL' }, outcome_corroboration: { state: 'FAIL' } }
    })
    const [row] = buildExchangeLedgerRows([bothRow], new Map())
    const tally = exceptionsFirstTally([row])
    expect(tally.failed).toBe(1)
    expect(tally.mismatched).toBe(1)
    expect(tally.needingAttention).toBe(1)
  })

  it('a clean row counts toward total only', () => {
    const [row] = buildExchangeLedgerRows([CLEAN_ROW], new Map())
    const tally = exceptionsFirstTally([row])
    expect(tally).toEqual({ total: 1, needingAttention: 0, failed: 0, mismatched: 0, askedUnanswered: 0 })
  })
})

describe('exceptionsFirstLine', () => {
  it('clean state leads with "Nothing needs your attention" and states the zero tally', () => {
    const line = exceptionsFirstLine(
      { total: 5, needingAttention: 0, failed: 0, mismatched: 0, askedUnanswered: 0 },
      '3 Sep – 11 Sep'
    )
    expect(line).toBe(
      'Nothing needs your attention. 5 exchanges, 3 Sep – 11 Sep, all sealed, all recomputed clean. 0 failed · 0 mismatched · 0 asked-and-unanswered.'
    )
  })

  it('non-clean state leads with the failing count, not "Nothing needs your attention"', () => {
    const line = exceptionsFirstLine(
      { total: 5, needingAttention: 2, failed: 1, mismatched: 1, askedUnanswered: 0 },
      '3 Sep – 11 Sep'
    )
    expect(line.startsWith('2 exchanges need your attention')).toBe(true)
    expect(line).not.toMatch(/Nothing needs your attention/)
    expect(line).toMatch(/1 failed · 1 mismatched · 0 asked-and-unanswered/)
  })

  it('singular phrasing for exactly one exchange needing attention', () => {
    const line = exceptionsFirstLine(
      { total: 3, needingAttention: 1, failed: 1, mismatched: 0, askedUnanswered: 0 },
      null
    )
    expect(line.startsWith('1 exchange needs your attention')).toBe(true)
  })

  it('states the range when available, omits it honestly when not', () => {
    const withRange = exceptionsFirstLine(
      { total: 1, needingAttention: 0, failed: 0, mismatched: 0, askedUnanswered: 0 },
      '3 Sep'
    )
    expect(withRange).toContain('1 exchange, 3 Sep, all sealed')

    const withoutRange = exceptionsFirstLine(
      { total: 1, needingAttention: 0, failed: 0, mismatched: 0, askedUnanswered: 0 },
      null
    )
    expect(withoutRange).toContain('1 exchange, all sealed')
    expect(withoutRange).not.toContain('null')
  })

  it('never renders a fraction/ratio for the tally', () => {
    const line = exceptionsFirstLine(
      { total: 5, needingAttention: 2, failed: 1, mismatched: 1, askedUnanswered: 0 },
      null
    )
    expect(line).not.toMatch(/\d+\/\d+/)
  })
})
