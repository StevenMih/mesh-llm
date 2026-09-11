import { describe, expect, it } from 'vitest'
import {
  deriveRightCellState,
  isAlarmState,
  rightCellAction,
  rightCellStatusLabel,
  rightCellText,
  type RightCellState,
  type RightCellStateKind
} from '@/features/capsules/lib/exchange-row-state'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'

function paneCRow(overrides: Partial<PaneCRow> = {}): PaneCRow {
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

const ALL_KINDS: RightCellStateKind[] = [
  'closed',
  'contradicted',
  'open_refused',
  'open_absent',
  'open_asked',
  'open_not_asked'
]

describe('deriveRightCellState — all six states reachable', () => {
  it('artifact, agrees -> closed', () => {
    const row = paneCRow({
      theirs: { state: 'present', capsule_id: 't1' },
      properties: { outcome_corroboration: { state: 'PASS' } }
    })
    expect(deriveRightCellState(row).kind).toBe('closed')
  })

  it('artifact, disagrees -> contradicted', () => {
    const row = paneCRow({
      theirs: { state: 'present', capsule_id: 't1' },
      properties: { outcome_corroboration: { state: 'FAIL' } }
    })
    expect(deriveRightCellState(row).kind).toBe('contradicted')
  })

  it('a present theirs record with no outcome_corroboration property at all defaults to closed, never an invented contradiction', () => {
    const row = paneCRow({ theirs: { state: 'present', capsule_id: 't1' }, properties: null })
    expect(deriveRightCellState(row).kind).toBe('closed')
  })

  it('signed_refusal evidence_outcome -> open_refused, carrying its date', () => {
    const row = paneCRow({
      theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'signed_refusal', evidence_outcome_date: '4 Sep' }
    })
    const state = deriveRightCellState(row)
    expect(state.kind).toBe('open_refused')
    expect(state.date).toBe('4 Sep')
  })

  it('recorded_absence evidence_outcome -> open_absent', () => {
    const row = paneCRow({
      theirs: {
        state: 'absent',
        capsule_id: null,
        evidence_outcome: 'recorded_absence',
        evidence_outcome_date: '4 Sep'
      }
    })
    expect(deriveRightCellState(row).kind).toBe('open_absent')
  })

  it('unanswered evidence_outcome -> open_asked', () => {
    const row = paneCRow({
      theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'unanswered', evidence_outcome_date: '3 Sep' }
    })
    expect(deriveRightCellState(row).kind).toBe('open_asked')
  })

  it('not_asked evidence_outcome -> open_not_asked', () => {
    const row = paneCRow({
      theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'not_asked' }
    })
    expect(deriveRightCellState(row).kind).toBe('open_not_asked')
  })

  it('ADVERSARIAL — L-C: an absent theirs record with NO evidence_outcome carried never becomes open_asked (we hold no ask-log, so we cannot claim we asked)', () => {
    const row = paneCRow({ theirs: { state: 'absent', capsule_id: null } })
    const state = deriveRightCellState(row)
    expect(state.kind).toBe('open_not_asked')
    expect(state.kind).not.toBe('open_asked')
  })

  it('every one of the six kinds is reachable', () => {
    const reached = new Set<RightCellStateKind>()
    reached.add(
      deriveRightCellState(
        paneCRow({
          theirs: { state: 'present', capsule_id: 't' },
          properties: { outcome_corroboration: { state: 'PASS' } }
        })
      ).kind
    )
    reached.add(
      deriveRightCellState(
        paneCRow({
          theirs: { state: 'present', capsule_id: 't' },
          properties: { outcome_corroboration: { state: 'FAIL' } }
        })
      ).kind
    )
    reached.add(
      deriveRightCellState(
        paneCRow({ theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'signed_refusal' } })
      ).kind
    )
    reached.add(
      deriveRightCellState(
        paneCRow({ theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'recorded_absence' } })
      ).kind
    )
    reached.add(
      deriveRightCellState(paneCRow({ theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'unanswered' } }))
        .kind
    )
    reached.add(deriveRightCellState(paneCRow({ theirs: { state: 'absent', capsule_id: null } })).kind)
    for (const kind of ALL_KINDS) expect(reached.has(kind)).toBe(true)
    expect(reached.size).toBe(6)
  })
})

function stateOf(kind: RightCellStateKind, date: string | null = null): RightCellState {
  return { kind, date }
}

describe('rightCellText — the load-bearing distinction', () => {
  it('LOAD-BEARING: not-asked and unanswered never render the same string', () => {
    const notAsked = rightCellText(stateOf('open_not_asked'))
    const unanswered = rightCellText(stateOf('open_asked', '3 Sep'))
    expect(notAsked).not.toBe(unanswered)
  })

  it('renders the exact copy from v3 §2 for each state', () => {
    expect(rightCellText(stateOf('closed'))).toBe('✓ cites your half by digest')
    expect(rightCellText(stateOf('contradicted'))).toBe('⚠ differs')
    expect(rightCellText(stateOf('open_refused', '4 Sep'))).toBe('They declined, and signed the refusal — 4 Sep')
    expect(rightCellText(stateOf('open_absent', '4 Sep'))).toBe('They say they have no record of this — 4 Sep')
    expect(rightCellText(stateOf('open_asked', '3 Sep'))).toBe('Asked 3 Sep. No reply yet.')
    expect(rightCellText(stateOf('open_not_asked'))).toBe("You haven't asked for their half.")
  })

  it('never invents a date when none is carried', () => {
    expect(rightCellText(stateOf('open_refused'))).toContain('date unavailable')
  })
})

describe('rightCellStatusLabel', () => {
  it('names all six statuses distinctly', () => {
    const labels = ALL_KINDS.map((kind) => rightCellStatusLabel(stateOf(kind)))
    expect(new Set(labels).size).toBe(6)
    expect(labels).toEqual(['CLOSED', 'CONTRADICTED', 'OPEN · refused', 'OPEN · absent', 'OPEN · asked', 'OPEN'])
  })
})

describe('rightCellAction', () => {
  it('closed has no action; every other state has one', () => {
    expect(rightCellAction(stateOf('closed'))).toBeNull()
    for (const kind of ALL_KINDS.filter((k) => k !== 'closed')) {
      expect(rightCellAction(stateOf(kind))).not.toBeNull()
    }
  })

  it('names the exact action from v3 §2', () => {
    expect(rightCellAction(stateOf('contradicted'))).toBe('Compare')
    expect(rightCellAction(stateOf('open_refused'))).toBe('View refusal')
    expect(rightCellAction(stateOf('open_absent'))).toBe('View statement')
    expect(rightCellAction(stateOf('open_asked'))).toBe('Ask again')
    expect(rightCellAction(stateOf('open_not_asked'))).toBe('Ask them for their half')
  })
})

describe('isAlarmState — L-A/L-B enforcement', () => {
  it('L-B: only CONTRADICTED is an alarm state', () => {
    expect(isAlarmState(stateOf('contradicted'))).toBe(true)
  })

  it('L-A: every OPEN state, and CLOSED, is never styled as a problem', () => {
    for (const kind of ALL_KINDS.filter((k) => k !== 'contradicted')) {
      expect(isAlarmState(stateOf(kind))).toBe(false)
    }
  })
})
