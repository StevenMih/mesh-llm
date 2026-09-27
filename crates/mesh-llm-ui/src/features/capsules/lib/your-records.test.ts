import { describe, expect, it } from 'vitest'
import type { RecordsStatus } from '@/features/capsules/api/recordsClient'
import { storedTextFromProbe } from '@/features/capsules/lib/use-your-records'
import {
  CLEANUP_OPTIONS,
  NEW_LOG_PENDING,
  cleanupBlockedReason,
  cleanupResultMessage,
  heroStatusLine,
  lastCheckpointFact,
  promptsPill,
  recordsLocationFact,
  sharingRows
} from '@/features/capsules/lib/your-records'
import { SAMPLE_DATA_UNAVAILABLE } from '@/features/capsules/lib/tooltip-copy'

function status(overrides: Partial<RecordsStatus> = {}): RecordsStatus {
  return {
    records_path: '/data/ledger',
    record_count: 8,
    head: 'a'.repeat(64),
    log_id: 'capsule-emit-mesh',
    stored_text_count: 0,
    new_history_pending: null,
    sharing: {
      record_at_completion: { value: 'counterparty', source: 'default' },
      history_segments: { value: 'prospective', source: 'default' },
      adjudications: { value: 'deliver_to_subjects', source: 'default' },
      witness: { value: null, source: 'default' }
    },
    ...overrides
  }
}

describe('hero line 3', () => {
  it('states the whole tab in one sentence, with the assurance in words', () => {
    expect(heroStatusLine({ records: 8, confirmed: 3, disagreements: 0, witnessed: false })).toBe(
      '8 records · 3 confirmed by the other side · 0 disagreements · checkable only by you (no witness)'
    )
    expect(heroStatusLine({ records: 1, confirmed: 0, disagreements: 1, witnessed: true })).toBe(
      '1 record · 0 confirmed by the other side · 1 disagreement · also held by a witness you don’t run'
    )
  })
})

describe('Your prompts pill', () => {
  it('says kept here / not kept from the count, and "not shown" when this view cannot tell', () => {
    expect(promptsPill(3).label).toBe('Your prompts · kept here')
    expect(promptsPill(0).label).toBe('Your prompts · not kept')
    expect(promptsPill(null).label).toBe('Your prompts · not shown')
  })

  it('without a status tool, the probe never rounds an unprobed tail down to "not kept"', () => {
    expect(storedTextFromProbe(2, 8, 8)).toBe(2)
    expect(storedTextFromProbe(0, 8, 8)).toBe(0)
    expect(storedTextFromProbe(0, 200, 500)).toBeNull()
    expect(storedTextFromProbe(1, 200, 500)).toBe(1)
  })
})

describe('What you share', () => {
  it('four switches in order, each with its setting, where it was set, and one sentence', () => {
    const rows = sharingRows(status())
    expect(rows.map((r) => r.key)).toEqual(['record_at_completion', 'history_segments', 'adjudications', 'witness'])
    expect(rows.map((r) => r.state)).toEqual([
      'to the other side',
      'to nodes you’ve dealt with or are about to',
      'to the node it’s about',
      'off'
    ])
    expect(rows.every((r) => r.source === 'default')).toBe(true)
    expect(rows[3].whatLeaves).toBe('Nothing is sent: no witness is set.')
  })

  it('a set witness names where checkpoints go, and never records or text', () => {
    const rows = sharingRows(
      status({ sharing: { ...status().sharing, witness: { value: 'https://w.example', source: 'set' } } })
    )
    expect(rows[3]).toMatchObject({ state: 'on', source: 'set' })
    expect(rows[3].whatLeaves).toBe('Your checkpoints, never records or text, go to https://w.example.')
  })

  it('without a status, no setting is claimed', () => {
    const rows = sharingRows(null)
    expect(rows.every((r) => r.state === null && r.source === null)).toBe(true)
  })
})

describe('Clean up records', () => {
  it('offers exactly three choices, and none of them removes a record', () => {
    expect(CLEANUP_OPTIONS.map((o) => o.action)).toEqual(['delete_stored_text', 'rebuild_index', 'start_new_log'])
    for (const option of CLEANUP_OPTIONS) expect(option.title).not.toMatch(/delete (a|one|this) record/i)
  })

  it('never runs on sample data or without a node that answered; a new log needs the box ticked and none waiting', () => {
    expect(cleanupBlockedReason('rebuild_index', { sample: true, status: status(), confirmed: true })).toBe(
      SAMPLE_DATA_UNAVAILABLE
    )
    expect(cleanupBlockedReason('rebuild_index', { sample: false, status: null, confirmed: true })).not.toBeNull()
    expect(cleanupBlockedReason('rebuild_index', { sample: false, status: status(), confirmed: false })).toBeNull()
    expect(cleanupBlockedReason('start_new_log', { sample: false, status: status(), confirmed: false })).not.toBeNull()
    expect(cleanupBlockedReason('start_new_log', { sample: false, status: status(), confirmed: true })).toBeNull()
    const waiting = status({ new_history_pending: { requested_at: 't', closing_record_id: 'c' } })
    expect(cleanupBlockedReason('start_new_log', { sample: false, status: waiting, confirmed: true })).toBe(
      NEW_LOG_PENDING
    )
  })

  it('names the record each cleanup sealed, and says so when nothing was', () => {
    const sealed = { capsule_id: 'c'.repeat(64), record_number: 9, kind: 'x' }
    expect(cleanupResultMessage({ action: 'delete_stored_text', deleted_count: 3, sealed })).toBe(
      'Deleted the stored text of 3 records. Sealed as record 9.'
    )
    expect(cleanupResultMessage({ action: 'delete_stored_text', deleted_count: 0, sealed: null })).toBe(
      'There was no stored text to delete, so nothing was sealed.'
    )
    expect(cleanupResultMessage({ action: 'rebuild_index', records_checked: 8, sealed })).toMatch(/Checked 8 records/)
    expect(cleanupResultMessage({ action: 'start_new_log', sealed })).toMatch(/next time this node starts/)
  })
})

describe('Your records facts', () => {
  it('location and checkpoint in words', () => {
    expect(recordsLocationFact(status(), false)).toBe('/data/ledger')
    expect(recordsLocationFact(null, true)).toBe('Not shown on sample data.')
    expect(lastCheckpointFact(8, '2026-09-26T17:37:20.014Z')).toBe(
      'Covers 8 records, made no later than 2026-09-26T17:37:20.014Z.'
    )
    expect(lastCheckpointFact(0, null)).toBe('No checkpoint yet.')
  })
})
