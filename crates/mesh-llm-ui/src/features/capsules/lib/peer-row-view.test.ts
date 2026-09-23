// Honesty-backbone invariants for the Peers tab ([mesh-ledger-peers-tab],
// [a18-evidence-peers-dedup-network]): with-you/their-chain facts are never
// summed, adjudications always carry a denominator, NOT_CHECKED never
// renders as a silent corroborated pass, and the new accountability columns
// (confirmed-by-other-side, match, period) never invent a fraction the
// sidecar doesn't back. These are the properties an adversarial reviewer
// would try to break, so they're asserted directly against the pure
// view-model functions rather than only through component snapshots.
import { describe, expect, it } from 'vitest'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import { LatencySource } from '@/lib/api/types'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import {
  adjudicationCompactText,
  adjudicationSummary,
  adjudicationSummaryText,
  alarmSignal,
  advertisedOnlyRowView,
  confirmedByOtherSide,
  confirmedByOtherSideText,
  dealtWithRowView,
  isUnattributedPeerRow,
  matchTally,
  matchTallyText,
  meshMetaLine,
  peerDisplayId,
  periodRangeText,
  peerSortKey,
  SELF_REPORTED_NOTE,
  sortPeerRows,
  theirChainSummary,
  unattributedExchangesLine,
  withYouCounts,
  withYouCountsText,
  WITNESS_COVERAGE_COMPACT_TEXT
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
    expect(adjudicationCompactText(summary)).toBe('none sealed')
  })

  it('always carries the exchange_count denominator alongside a real tally, compact form matches the full form', () => {
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
    expect(adjudicationCompactText(summary)).toBe('8 of 24 · 8 corroborated')
  })

  it('never drops a contradicted/inconclusive count out of either the full or compact summary text', () => {
    const row = baseRow({
      exchange_count: 14,
      verdicts: { state: 'contradicted', text: '', tally: { corroborated: 6, contradicted: 1, inconclusive: 2 } }
    })
    const summary = adjudicationSummary(row)
    expect(adjudicationSummaryText(summary)).toBe('9 of 14 adjudicated · 6 corroborated · 1 contradicted · 2 inconclusive')
    expect(adjudicationCompactText(summary)).toBe('9 of 14 · 6 corroborated · 1 contradicted · 2 inconclusive')
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

describe('confirmedByOtherSide — the on-demand peer-fetch mechanism, distinct from local match', () => {
  it('is honestly 0/total with "peer-fetch pending" when no peer-fetch has ever run (the common case today)', () => {
    const row = baseRow({ exchange_count: 11, history: { state: 'NOT_CHECKED', text: null } })
    const summary = confirmedByOtherSide(row)
    expect(summary).toEqual({ confirmed: 0, total: 11, note: 'peer-fetch pending' })
    expect(confirmedByOtherSideText(summary)).toBe('0 / 11 (peer-fetch pending)')
  })

  it('counts every exchange confirmed only when the peer-fetch actually verified their chain -- never invented partial credit', () => {
    const row = baseRow({
      exchange_count: 24,
      history: { state: 'verified', text: '', history_summary: { verified_bundles: 5, checkpoint_count: 41 } }
    })
    const summary = confirmedByOtherSide(row)
    expect(summary).toEqual({ confirmed: 24, total: 24, note: null })
    expect(confirmedByOtherSideText(summary)).toBe('24 / 24')
  })

  it('reports a failed peer-fetch as 0, never as unbroken', () => {
    const row = baseRow({ exchange_count: 14, history: { state: 'failed', text: 'chain diverged' } })
    expect(confirmedByOtherSideText(confirmedByOtherSide(row))).toBe('0 / 14 (peer-fetch failed)')
  })

  it('reports a refused peer-fetch distinctly from a failed one', () => {
    const row = baseRow({ exchange_count: 3, history: { state: 'refused', text: 'refused' } })
    expect(confirmedByOtherSideText(confirmedByOtherSide(row))).toBe('0 / 3 (peer refused)')
  })
})

describe('matchTally — local two-sided-capture reconciliation, distinct from confirmedByOtherSide', () => {
  it('always shows clean/mismatch even at zero, omits contradicted when zero', () => {
    const row = baseRow({ pair: { state: 'verified', text: '', verified: 11, failed: 0, missing: 0, details: [] } })
    expect(matchTally(row)).toEqual({ clean: 11, mismatch: 0, contradicted: 0 })
    expect(matchTallyText(matchTally(row))).toBe('11 clean · 0 mismatch')
  })

  it('appends the contradicted count from the adjudication tally when nonzero', () => {
    const row = baseRow({
      pair: { state: 'failed', text: '', verified: 9, failed: 1, missing: 0, details: [] },
      verdicts: { state: 'contradicted', text: '', tally: { corroborated: 6, contradicted: 1, inconclusive: 0 } }
    })
    expect(matchTallyText(matchTally(row))).toBe('9 clean · 1 mismatch · 1 contradicted')
  })
})

describe('periodRangeText', () => {
  it('is "—" with no exchange history to bound', () => {
    expect(periodRangeText(null, null)).toBe('—')
  })

  it('compresses a same-month range to "D–D Mon"', () => {
    expect(periodRangeText('2026-09-22T00:00:00Z', '2026-09-23T00:00:00Z')).toBe('22–23 Sep')
  })

  it('spells out both months when the range crosses a month boundary', () => {
    expect(periodRangeText('2026-08-20T09:12:00Z', '2026-09-08T16:58:05Z')).toBe('20 Aug – 8 Sep')
  })

  it('spells out both years when the range crosses a year boundary', () => {
    expect(periodRangeText('2025-12-30T00:00:00Z', '2026-01-02T00:00:00Z')).toBe('30 Dec 2025 – 2 Jan 2026')
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

describe('peerDisplayId — no synthetic peer', () => {
  it('ADVERSARIAL: never returns the string "unknown peer" — a row with no identity resolves to null', () => {
    const row = baseRow({ peer_id: null, node: { state: 'present', text: null } })
    expect(peerDisplayId(row)).toBeNull()
    expect(peerDisplayId(row)).not.toBe('unknown peer')
    expect(isUnattributedPeerRow(row)).toBe(true)
  })

  it('falls back to the node cell id when the row-level peer_id is absent', () => {
    const row = baseRow({ peer_id: null, node: { state: 'present', text: null, peer_id: 'node:aa11bb22cc33' } })
    expect(peerDisplayId(row)).toBe('node:aa11bb22cc33')
    expect(isUnattributedPeerRow(row)).toBe(false)
  })

  it('prefers the row-level peer_id over the node cell id when both are present', () => {
    const row = baseRow({ peer_id: 'peer-verified', node: { state: 'present', text: null, peer_id: 'node:other' } })
    expect(peerDisplayId(row)).toBe('peer-verified')
  })
})

describe('unattributedExchangesLine', () => {
  it('states the count as a fact, never implying pending work', () => {
    expect(unattributedExchangesLine(3)).toBe('3 exchanges have no counterparty recorded yet. They appear under Exchanges.')
    expect(unattributedExchangesLine(3)).not.toMatch(/not resolved yet/i)
  })

  it('uses singular grammar for a count of one', () => {
    expect(unattributedExchangesLine(1)).toBe('1 exchange has no counterparty recorded yet. They appear under Exchanges.')
  })
})

describe('meshMetaLine — still used by the PeerInspector modal', () => {
  function meshStatus(overrides: Partial<PeerMeshStatus> = {}): PeerMeshStatus {
    return {
      modelName: 'Qwen3.6-27B-UD',
      quant: 'Q4_K_XL',
      contextLengthK: 256,
      latencyMs: 38,
      latencySource: LatencySource.DIRECT,
      online: true,
      ...overrides
    }
  }

  it('joins model/quant/context', () => {
    expect(meshMetaLine(meshStatus())).toBe('Qwen3.6-27B-UD · Q4_K_XL · 256k ctx')
  })

  it('degrades to null (never a fabricated line) when nothing is known', () => {
    expect(meshMetaLine(null)).toBeNull()
  })
})

describe('dealtWithRowView / advertisedOnlyRowView — one shape, honest degradation', () => {
  it('a dealt-with row carries the real Pane B row, exchange count, and every accountability column', () => {
    const row = baseRow({
      peer_id: 'node:abc',
      pair: { state: 'verified', text: '', verified: 16, failed: 0, missing: 0, details: [] },
      exchange_count: 24,
      first_seen: '2026-09-01T00:00:00Z',
      last_seen: '2026-09-03T00:00:00Z',
      verdicts: { state: 'present', text: '', tally: { corroborated: 8, contradicted: 0, inconclusive: 0 } }
    })
    const view = dealtWithRowView(row)
    expect(view.hasDealings).toBe(true)
    expect(view.row).toBe(row)
    expect(view.identityNote).toBe(SELF_REPORTED_NOTE)
    expect(view.exchangeCount).toBe(24)
    expect(view.match).toBe('16 clean · 0 mismatch')
    expect(view.adjudicationCompact).toBe('8 of 24 · 8 corroborated')
    expect(view.witnessCompact).toBe(WITNESS_COVERAGE_COMPACT_TEXT)
    expect(view.period).toBe('1–3 Sep')
    expect(view.confirmedByOtherSide).toBe('0 / 24 (peer-fetch pending)')
  })

  it('a zero-dealings advertised-only peer shows "no exchanges yet" and "—" for every accountability column, never a fabricated zero-of-zero', () => {
    const view = advertisedOnlyRowView('node:unused')
    expect(view.hasDealings).toBe(false)
    expect(view.row).toBeNull()
    expect(view.identityNote).toBe('no exchanges yet')
    expect(view.exchangeCount).toBe(0)
    for (const field of [view.confirmedByOtherSide, view.match, view.adjudicationCompact, view.witnessCompact, view.period]) {
      expect(field).toBe('—')
    }
  })

  it('no accountability figure on either view ever renders a percentage or ratio ramp (R-D)', () => {
    const row = baseRow({
      exchange_count: 24,
      verdicts: { state: 'present', text: '', tally: { corroborated: 8, contradicted: 0, inconclusive: 0 } }
    })
    const dealtWith = dealtWithRowView(row)
    const advertised = advertisedOnlyRowView('node:unused')
    for (const view of [dealtWith, advertised]) {
      for (const text of [view.confirmedByOtherSide, view.match, view.adjudicationCompact, view.witnessCompact, view.period]) {
        expect(text).not.toContain('%')
      }
    }
  })
})
