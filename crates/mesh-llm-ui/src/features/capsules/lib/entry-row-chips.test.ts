import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import {
  ENTRY_ROW_CHIP_ORDER,
  entryRowChipMark,
  entryRowChipPropertyKey
} from '@/features/capsules/lib/entry-row-chips'

function rowWithProperties(properties: PaneCRow['properties']): PaneCRow {
  return {
    exchange_key: 'exch-1',
    role_tag: 'ASKED',
    header_state: 'ok',
    properties,
    has_issue: false,
    mine: { state: 'present', capsule_id: 'mine-1' },
    theirs: { state: 'absent', capsule_id: null },
    unilateral: false,
    timestamp: null
  }
}

describe('entryRowChipPropertyKey', () => {
  it('names the exact property each chip is a link into, verbatim design §3A', () => {
    expect(entryRowChipPropertyKey('content')).toBe('content_binding')
    expect(entryRowChipPropertyKey('sig')).toBe('producer_signature')
    expect(entryRowChipPropertyKey('inclusion')).toBe('local_inclusion')
    expect(entryRowChipPropertyKey('registered')).toBe('external_registration')
    expect(entryRowChipPropertyKey('theirs')).toBe('outcome_corroboration')
  })

  it('orders the strip content · sig · inclusion · registered · theirs', () => {
    expect(ENTRY_ROW_CHIP_ORDER).toEqual(['content', 'sig', 'inclusion', 'registered', 'theirs'])
  })
})

describe('entryRowChipMark', () => {
  it('PASS -> ✓', () => {
    const row = rowWithProperties({ content_binding: { state: 'PASS' } })
    expect(entryRowChipMark(row, 'content')).toBe('✓')
  })

  it('FAIL -> ✗', () => {
    const row = rowWithProperties({ producer_signature: { state: 'FAIL' } })
    expect(entryRowChipMark(row, 'sig')).toBe('✗')
  })

  it.each(['NOT_PRESENT', 'NOT_CHECKED', 'INCONCLUSIVE'])(
    '%s -> the neutral dash, never a fabricated pass/fail',
    (state) => {
      const row = rowWithProperties({ local_inclusion: { state } })
      expect(entryRowChipMark(row, 'inclusion')).toBe('–')
    }
  )

  it('a `properties` object entirely absent the property -> the neutral dash', () => {
    const row = rowWithProperties({ content_binding: { state: 'PASS' } })
    expect(entryRowChipMark(row, 'registered')).toBe('–')
  })

  it('`properties: null` (no map at all) -> the neutral dash for every chip', () => {
    const row = rowWithProperties(null)
    for (const chip of ENTRY_ROW_CHIP_ORDER) {
      expect(entryRowChipMark(row, chip)).toBe('–')
    }
  })
})
