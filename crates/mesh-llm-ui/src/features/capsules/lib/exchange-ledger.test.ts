import { describe, expect, it } from 'vitest'
import { buildExchangeCounterpartyIndex, buildExchangeLedgerRows } from '@/features/capsules/lib/exchange-ledger'
import type { PaneBRow, PaneCRow } from '@/features/capsules/api/sidecarTypes'

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

describe('buildExchangeLedgerRows', () => {
  it('Checks is an em-dash for a clean row, never a count', () => {
    const [row] = buildExchangeLedgerRows([paneCRow({ has_issue: false })], new Map())
    expect(row.checksText).toBe('—')
    expect(row.checksText).not.toMatch(/\d\/\d/)
  })

  it('Checks names the specific failing property, never a count, when the row has an issue', () => {
    const [row] = buildExchangeLedgerRows(
      [
        paneCRow({
          has_issue: true,
          properties: {
            content_binding: { state: 'PASS' },
            checkpoint_signature: { state: 'FAIL', text: 'could not verify against the pinned key' }
          }
        })
      ],
      new Map()
    )
    expect(row.checksText).toBe('checkpoint signature')
    expect(row.checksText).not.toMatch(/\d\/\d/)
  })

  it('ADVERSARIAL: a NOT_CHECKED or NOT_PRESENT property is never named as a Checks exception — only a real FAIL is', () => {
    const [row] = buildExchangeLedgerRows(
      [
        paneCRow({
          // has_issue is false here on purpose: an honest NOT_CHECKED/
          // NOT_PRESENT property is never, by itself, an "issue" (the
          // backend's own has_issue rule this view trusts), so Checks
          // must never surface one as though it were a failing check.
          has_issue: false,
          properties: {
            content_binding: { state: 'PASS' },
            checkpoint_signature: { state: 'NOT_CHECKED' },
            identity_authority: { state: 'NOT_PRESENT' }
          }
        })
      ],
      new Map()
    )
    expect(row.checksText).toBe('—')
  })

  it('ADVERSARIAL: never corroborates a no-verdict case — a false has_issue with a stray FAIL-looking property still reports only real FAILs', () => {
    // Even if `has_issue` were true for an unrelated reason, checksTextFor
    // only ever names properties whose OWN state is the literal string
    // 'FAIL' -- NOT_CHECKED/NOT_PRESENT never qualify, so this can't drift
    // into treating "unknown" as "bad" (nor the inverse).
    const [row] = buildExchangeLedgerRows(
      [
        paneCRow({
          has_issue: true,
          properties: {
            content_binding: { state: 'NOT_CHECKED' },
            checkpoint_signature: { state: 'FAIL' },
            capture_coverage: { state: 'NOT_PRESENT' }
          }
        })
      ],
      new Map()
    )
    expect(row.checksText).toBe('checkpoint signature')
    expect(row.checksText).not.toMatch(/content binding|capture coverage/)
  })

  it('falls back to naming the pair-reconciliation check when has_issue is true but no named property failed', () => {
    const [row] = buildExchangeLedgerRows(
      [paneCRow({ has_issue: true, properties: { content_binding: { state: 'PASS' } } })],
      new Map()
    )
    expect(row.checksText).toBe('pair reconciliation')
  })

  it('Confirmed is the double-entry fact (theirs present and not unilateral), not registration', () => {
    const rows = buildExchangeLedgerRows(
      [
        paneCRow({ exchange_key: 'exch-confirmed', theirs: { state: 'present', capsule_id: 't' }, unilateral: false }),
        paneCRow({ exchange_key: 'exch-unilateral', theirs: { state: 'absent', capsule_id: null }, unilateral: true })
      ],
      new Map()
    )
    expect(rows.find((r) => r.exchangeKey === 'exch-confirmed')?.confirmed).toBe(true)
    expect(rows.find((r) => r.exchangeKey === 'exch-unilateral')?.confirmed).toBe(false)
  })

  it('names the counterparty from the Pane B join, never inventing one when absent', () => {
    const index = new Map([['exch-1', 'node:aa11bb22']])
    const [named] = buildExchangeLedgerRows([paneCRow({ exchange_key: 'exch-1' })], index)
    const [unnamed] = buildExchangeLedgerRows([paneCRow({ exchange_key: 'exch-2' })], index)
    expect(named.counterparty).toBe('node:aa11bb22')
    expect(unnamed.counterparty).toBeNull()
  })
})

describe('buildExchangeCounterpartyIndex', () => {
  it("maps every exchange_id a peer reconciled to that peer's display id", () => {
    const peer: PaneBRow = {
      peer_id: 'node:peer-a',
      node: { state: 'present' },
      rung: { state: 'present' },
      role: { state: 'present' },
      history: { state: 'NOT_CHECKED' },
      served: { state: 'NOT_CHECKED' },
      pair: {
        state: 'verified',
        verified: 1,
        failed: 0,
        missing: 0,
        details: [{ exchange_id: 'exch-a', state: 'verified' }]
      },
      verdicts: { state: 'NOT_CHECKED' },
      asked: { state: 'absent' },
      exchange_count: 1,
      first_seen: null,
      last_seen: null
    }
    const index = buildExchangeCounterpartyIndex([peer])
    expect(index.get('exch-a')).toBe('node:peer-a')
    expect(index.has('exch-nonexistent')).toBe(false)
  })
})
