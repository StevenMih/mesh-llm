import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import {
  CHAT_EVIDENCE_POLL_MS,
  chatEvidenceChip,
  chatEvidenceChipForTurn,
  chatEvidencePollMs,
  evidenceRowKeyForChat,
  evidenceRowKeyForLink,
  recordExchangeKey
} from '@/features/capsules/lib/chat-evidence-link'
import {
  ASK_FOR_RECORD_AFTER_MS,
  rightCellText,
  deriveRightCellState
} from '@/features/capsules/lib/exchange-row-state'
import {
  FIXTURE_REQUEST_DIGEST,
  fixtureMineCell,
  fixtureTheirsCell
} from '@/features/capsules/lib/pushed-half-fixtures'
import { CHAT_EVIDENCE_CHIP_TOOLTIPS } from '@/features/capsules/lib/tooltip-copy'

const NONCE = '14af686f-86e5-4baa-bb6b-d3dd3c81cfec'
const SERVED_EXCHANGE_ID = '956801c1-df95-4942-8642-5b9b570663a4'
const ROW_KEY = `digest:${FIXTURE_REQUEST_DIGEST}`
const OTHER_KEY = `digest:${'9'.repeat(64)}`

/** A sealed record as the ledger holds it: digest, and optionally the
 *  requester's nonce or the served path's exchange id. */
function sealedRecord(opts: { digest?: string | null; exchangeId?: string; nonce?: string } = {}): CapsuleRecord {
  const effect = opts.digest === null ? {} : { request_digest: opts.digest ?? FIXTURE_REQUEST_DIGEST }
  return {
    capsule_id: 'd'.repeat(64),
    effect,
    model_attestation: {
      compute_attestation: {
        'x-mesh-poc-v1': {
          ...(opts.nonce ? { client_nonce: opts.nonce } : {}),
          serving_provenance: opts.exchangeId ? { exchange_id: opts.exchangeId } : {}
        }
      }
    }
  }
}

function row(overrides: Partial<PaneCRow> = {}): PaneCRow {
  return {
    exchange_key: ROW_KEY,
    role_tag: 'ASKED',
    counterparty: 'node:a70d3967bea3b22f',
    header_state: 'absent',
    properties: null,
    has_issue: false,
    mine: { state: 'present-unverified', capsule_id: 'd'.repeat(64), role: 'requested' },
    theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1790399191638' },
    unilateral: true,
    timestamp: '2026-09-26T05:06:31.706Z',
    ...overrides
  }
}

describe('recordExchangeKey follows the host exchange_key_for rules (hand-built inputs; no shared Rust fixture)', () => {
  it('prefers the request digest over the exchange id', () => {
    expect(recordExchangeKey(sealedRecord({ exchangeId: SERVED_EXCHANGE_ID }))).toBe(ROW_KEY)
  })

  it('keys an empty digest string as the host does, never falling back', () => {
    expect(recordExchangeKey(sealedRecord({ digest: '', exchangeId: SERVED_EXCHANGE_ID }))).toBe('digest:')
  })

  it('falls back to the exchange id only when there is no digest', () => {
    expect(recordExchangeKey(sealedRecord({ digest: null, exchangeId: SERVED_EXCHANGE_ID }))).toBe(SERVED_EXCHANGE_ID)
  })

  it('never keys on the placeholder "unknown"', () => {
    expect(recordExchangeKey(sealedRecord({ digest: null, exchangeId: 'unknown' }))).toBeNull()
  })
})

describe('evidenceRowKeyForChat', () => {
  it('finds the row through the client nonce sealed in our requester record', () => {
    expect(evidenceRowKeyForChat(NONCE, [row()], [sealedRecord({ nonce: NONCE })])).toBe(ROW_KEY)
  })

  it('finds a record carried only on the row, not in the ledger', () => {
    const withBody = row({ mine: { ...fixtureMineCell(), record: sealedRecord({ nonce: NONCE }) } })
    expect(evidenceRowKeyForChat(NONCE, [withBody], [])).toBe(ROW_KEY)
  })

  it('returns nothing when no held record carries the nonce -- no guessing', () => {
    expect(evidenceRowKeyForChat('no-such-nonce', [row()], [sealedRecord({ nonce: NONCE })])).toBeNull()
  })

  it('returns nothing when the record is found but no row has its key', () => {
    expect(
      evidenceRowKeyForChat(NONCE, [row({ exchange_key: OTHER_KEY })], [sealedRecord({ nonce: NONCE })])
    ).toBeNull()
  })

  it('two records with one nonce on the same row (a twin clone) still find it', () => {
    const records = [sealedRecord({ nonce: NONCE }), sealedRecord({ nonce: NONCE })]
    expect(evidenceRowKeyForChat(NONCE, [row()], records)).toBe(ROW_KEY)
  })

  it('one nonce on records of two different rows is ambiguous: nothing', () => {
    const records = [sealedRecord({ nonce: NONCE }), sealedRecord({ nonce: NONCE, digest: '9'.repeat(64) })]
    expect(evidenceRowKeyForChat(NONCE, [row(), row({ exchange_key: OTHER_KEY })], records)).toBeNull()
  })
})

describe('evidenceRowKeyForLink (the Logs deep link)', () => {
  it('passes a row key through unchanged', () => {
    expect(evidenceRowKeyForLink(ROW_KEY, [row()], [])).toBe(ROW_KEY)
  })

  it('resolves the exchange id a host-served record seals to its digest row key', () => {
    expect(evidenceRowKeyForLink(SERVED_EXCHANGE_ID, [row()], [sealedRecord({ exchangeId: SERVED_EXCHANGE_ID })])).toBe(
      ROW_KEY
    )
  })

  it('returns nothing for an id no record names', () => {
    expect(
      evidenceRowKeyForLink('no-such-exchange', [row()], [sealedRecord({ exchangeId: SERVED_EXCHANGE_ID })])
    ).toBeNull()
  })
})

describe('chatEvidenceChip -- the Evidence row gate, restated for Chat', () => {
  const closed = row({ mine: fixtureMineCell(), theirs: fixtureTheirsCell('agrees') })

  it('reads "confirmed by the other side" on a CLOSED row', () => {
    expect(chatEvidenceChip(closed)).toEqual({
      kind: 'confirmed',
      label: 'sealed ✓ · confirmed by the other side',
      tooltip: CHAT_EVIDENCE_CHIP_TOOLTIPS.confirmed
    })
  })

  it('reads "confirmed" on no row state but CLOSED', () => {
    const rows: PaneCRow[] = [
      row(),
      row({ theirs: { state: 'absent', capsule_id: null } }),
      row({ mine: fixtureMineCell(), theirs: fixtureTheirsCell('disagrees') }),
      row({ mine: fixtureMineCell(), theirs: { ...fixtureTheirsCell('agrees'), signature_ok: false } }),
      row({ mine: fixtureMineCell(), theirs: { ...fixtureTheirsCell('agrees'), id_match: null } }),
      row({ theirs: { state: 'present', capsule_id: null, evidence_outcome: 'signed_refusal' } }),
      row({ theirs: { state: 'present', capsule_id: null, evidence_outcome: 'recorded_absence' } }),
      row({ theirs: { state: 'present', capsule_id: null, evidence_outcome: 'unanswered' } })
    ]
    for (const candidate of rows) {
      expect(deriveRightCellState(candidate).kind).not.toBe('closed')
      expect(chatEvidenceChip(candidate)?.kind).not.toBe('confirmed')
    }
  })

  it('says "not received yet" exactly where the Evidence row says their record hasn’t arrived', () => {
    const unsigned = row({ mine: fixtureMineCell(), theirs: { ...fixtureTheirsCell('agrees'), signature_ok: false } })
    for (const candidate of [row(), unsigned]) {
      expect(rightCellText(deriveRightCellState(candidate))).toBe('Their record hasn’t arrived yet.')
      expect(chatEvidenceChip(candidate)?.label).toBe('sealed · their record not received yet')
    }
  })

  it('a row with no one asked says so, not "not received yet"', () => {
    expect(chatEvidenceChip(row({ counterparty: null, theirs: { state: 'absent', capsule_id: null } }))?.label).toBe(
      'sealed · their record not asked for'
    )
  })

  it('names a disagreement, a signed refusal and a recorded absence as such', () => {
    expect(chatEvidenceChip(row({ mine: fixtureMineCell(), theirs: fixtureTheirsCell('disagrees') }))?.label).toBe(
      'sealed · their record differs'
    )
    expect(
      chatEvidenceChip(row({ theirs: { state: 'present', capsule_id: null, evidence_outcome: 'signed_refusal' } }))
        ?.kind
    ).toBe('declined')
    expect(
      chatEvidenceChip(row({ theirs: { state: 'present', capsule_id: null, evidence_outcome: 'recorded_absence' } }))
        ?.kind
    ).toBe('they_have_none')
  })

  it('renders nothing when this node holds no record of its own', () => {
    expect(chatEvidenceChip(row({ mine: { state: 'absent', capsule_id: null } }))).toBeNull()
  })
})

describe('chatEvidencePollMs -- polls only while something can still arrive', () => {
  const turnAt = '2026-09-26T05:06:31.706Z'
  const soon = Date.parse(turnAt) + 60_000
  const late = Date.parse(turnAt) + ASK_FOR_RECORD_AFTER_MS

  it('polls while the turn has no row yet, or their record is not in', () => {
    expect(chatEvidencePollMs(null, turnAt, soon)).toBe(CHAT_EVIDENCE_POLL_MS)
    expect(
      chatEvidencePollMs(chatEvidenceChipForTurn(NONCE, [row()], [sealedRecord({ nonce: NONCE })]), turnAt, soon)
    ).toBe(CHAT_EVIDENCE_POLL_MS)
  })

  it('stops once the chip is settled', () => {
    const closed = row({ mine: fixtureMineCell(), theirs: fixtureTheirsCell('agrees') })
    const found = chatEvidenceChipForTurn(NONCE, [closed], [sealedRecord({ nonce: NONCE })])
    expect(found?.chip.kind).toBe('confirmed')
    expect(chatEvidencePollMs(found, turnAt, soon)).toBe(false)
  })

  it('stops once the turn is older than the row’s own wait, found or not', () => {
    expect(chatEvidencePollMs(null, turnAt, late)).toBe(false)
  })
})
