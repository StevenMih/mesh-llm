// Honesty-backbone invariants for the Peers tab ([mesh-ledger-peers-tab]):
// with-you/their-chain facts are never summed, adjudications always carry
// a denominator, and NOT_CHECKED never renders as a silent corroborated
// pass. These are the properties an adversarial reviewer would try to
// break, so they're asserted directly against the pure view-model
// functions rather than only through component snapshots.
import { describe, expect, it } from 'vitest'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import {
  adjudicationSummary,
  adjudicationSummaryText,
  alarmSignal,
  peerSortKey,
  sortPeerRows,
  theirChainSummary,
  withYouCounts,
  withYouCountsText
} from '@/features/capsules/lib/peer-row-view'

function baseRow(overrides: Partial<PaneBRow> = {}): PaneBRow {
  return {
    peer_id: 'node:test-peer',
    node: { state: 'present', text: 'node:test-peer' },
    rung: { state: 'present', text: 'full_bilateral', rung: 'full_bilateral' },
    role: { state: 'present', text: '', role: 'both', you_to_them_count: 0, them_to_you_count: 0, exchange_count: 0 },
    history: { state: 'NOT_CHECKED', text: null },
    served: { state: 'NOT_CHECKED', text: null },
    pair: { state: 'absent', text: null, verified: 0, failed: 0, missing: 0, details: [] },
    verdicts: { state: 'NOT_CHECKED', text: null, tally: { corroborated: 0, contradicted: 0, inconclusive: 0 } },
    asked: { state: 'absent', text: null, count: 0 },
    exchange_count: 0,
    first_seen: null,
    last_seen: null,
    ...overrides
  }
}

describe('withYouCounts', () => {
  it('reads requested/served/confirmed from role_and_count_cell and pair_cell, never invents a field', () => {
    const row = baseRow({
      role: {
        state: 'present',
        text: '',
        role: 'both',
        you_to_them_count: 24,
        them_to_you_count: 12,
        exchange_count: 36
      },
      pair: { state: 'verified', text: '', verified: 20, failed: 0, missing: 0, details: [] }
    })
    expect(withYouCounts(row)).toEqual({ requested: 24, served: 12, confirmed: 20 })
    expect(withYouCountsText(withYouCounts(row))).toBe('24 requested · 12 served · 20 confirmed')
  })
})

describe('adjudicationSummary honesty invariants', () => {
  it('never summarizes a NOT_CHECKED verdicts cell as corroborated, even with a nonzero exchange_count', () => {
    const row = baseRow({
      exchange_count: 24,
      verdicts: { state: 'NOT_CHECKED', text: null, tally: { corroborated: 0, contradicted: 0, inconclusive: 0 } }
    })
    const summary = adjudicationSummary(row)
    expect(summary.notChecked).toBe(true)
    const text = adjudicationSummaryText(summary)
    expect(text).not.toMatch(/corroborated/)
    expect(text.toLowerCase()).toContain('not yet checked')
  })

  it('always carries the exchange_count denominator alongside a real tally', () => {
    const row = baseRow({
      exchange_count: 24,
      verdicts: { state: 'present', text: '', tally: { corroborated: 8, contradicted: 0, inconclusive: 0 } }
    })
    const summary = adjudicationSummary(row)
    expect(summary).toEqual({
      checked: 8,
      denominator: 24,
      corroborated: 8,
      contradicted: 0,
      inconclusive: 0,
      notChecked: false
    })
    expect(adjudicationSummaryText(summary)).toBe('8 of 24 adjudicated · 8 corroborated')
  })

  it('never drops a contradicted/inconclusive count out of the summary text', () => {
    const row = baseRow({
      exchange_count: 14,
      verdicts: { state: 'contradicted', text: '', tally: { corroborated: 6, contradicted: 1, inconclusive: 2 } }
    })
    const text = adjudicationSummaryText(adjudicationSummary(row))
    expect(text).toBe('9 of 14 adjudicated · 6 corroborated · 1 contradicted · 2 inconclusive')
  })

  it('treats an all-zero tally as not-checked even if the cell state claims "present"', () => {
    // Defends against a future backend regression where a present-but-empty
    // tally could otherwise read as "0 corroborated" (which looks like a
    // clean bill, not "nothing was checked").
    const row = baseRow({
      exchange_count: 5,
      verdicts: { state: 'present', text: '', tally: { corroborated: 0, contradicted: 0, inconclusive: 0 } }
    })
    expect(adjudicationSummary(row).notChecked).toBe(true)
  })
})

describe('theirChainSummary — never presents your own chain as theirs', () => {
  it('labels the common NOT_CHECKED case honestly, without the word "pending"', () => {
    const row = baseRow({
      history: {
        state: 'NOT_CHECKED',
        text: null,
        mine_for_reference: { history: { state: 'verified', text: '', history_depth: 9, checkpoint_count: 9 } }
      }
    })
    const chain = theirChainSummary(row)
    expect(chain.state).toBe('NOT_CHECKED')
    expect(chain.ownChainForReferenceOnly).toBe(true)
    expect(chain.text.toLowerCase()).not.toMatch(/\bpending\b/)
  })

  it('only claims "unbroken" when a real peer-fetch verified history_summary backs it', () => {
    const row = baseRow({
      history: {
        state: 'verified',
        text: '',
        history_summary: { verified_bundles: 5, checkpoint_count: 41 }
      }
    })
    const chain = theirChainSummary(row)
    expect(chain.text).toContain('41')
    expect(chain.text).toMatch(/^Unbroken/)
    expect(chain.ownChainForReferenceOnly).toBe(false)
  })

  it('reports a failed verification honestly, never as unbroken', () => {
    const row = baseRow({ history: { state: 'failed', text: 'fetch verification failed: chain diverged' } })
    const chain = theirChainSummary(row)
    expect(chain.text).not.toMatch(/^Unbroken/)
    expect(chain.text).toMatch(/failed/i)
  })
})

describe('alarmSignal', () => {
  it('surfaces a contradiction with a resolved date when the ledger has it', () => {
    const row = baseRow({
      verdicts: {
        state: 'contradicted',
        text: '',
        tally: { corroborated: 6, contradicted: 1, inconclusive: 0 },
        adjudication_capsule_id: 'cap-0007'
      }
    })
    const alarm = alarmSignal(row, (id) => (id === 'cap-0007' ? '2026-09-01' : null))
    expect(alarm).toEqual({ present: true, text: 'Contradiction found 2026-09-01', tone: 'bad' })
  })

  it('never fabricates a date when the local ledger has no matching record', () => {
    const row = baseRow({
      verdicts: {
        state: 'contradicted',
        text: '',
        tally: { corroborated: 0, contradicted: 1, inconclusive: 0 },
        adjudication_capsule_id: 'cap-unknown'
      }
    })
    const alarm = alarmSignal(row, () => null)
    expect(alarm.text).toBe('Contradiction found')
  })

  it('is absent for a clean row', () => {
    expect(alarmSignal(baseRow()).present).toBe(false)
  })
})

describe('sortPeerRows', () => {
  it('floats an alarmed row above a lower-latency clean row', () => {
    const clean = baseRow({ peer_id: 'clean' })
    const alarmed = baseRow({
      peer_id: 'alarmed',
      verdicts: { state: 'contradicted', text: '', tally: { corroborated: 0, contradicted: 1, inconclusive: 0 } }
    })
    const sorted = sortPeerRows(
      [
        { row: clean, latencyMs: 10 },
        { row: alarmed, latencyMs: 500 }
      ],
      ({ row, latencyMs }) => peerSortKey(row, latencyMs)
    )
    expect(sorted.map((entry) => entry.row.peer_id)).toEqual(['alarmed', 'clean'])
  })

  it('sorts two clean rows closest-first by latency', () => {
    const near = baseRow({ peer_id: 'near' })
    const far = baseRow({ peer_id: 'far' })
    const sorted = sortPeerRows(
      [
        { row: far, latencyMs: 200 },
        { row: near, latencyMs: 5 }
      ],
      ({ row, latencyMs }) => peerSortKey(row, latencyMs)
    )
    expect(sorted.map((entry) => entry.row.peer_id)).toEqual(['near', 'far'])
  })
})
