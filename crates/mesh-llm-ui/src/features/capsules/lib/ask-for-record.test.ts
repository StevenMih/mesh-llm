import { ed25519 } from '@noble/curves/ed25519'
import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import {
  FIXTURE_PROVIDER_NODE,
  FIXTURE_REQUEST_DIGEST,
  fixtureHalfBody
} from '@/features/capsules/lib/pushed-half-fixtures'
import { ASK_FOR_RECORD_AFTER_MS } from '@/features/capsules/lib/exchange-row-state'
import {
  askIsOffered,
  askTarget,
  judgeAskReply,
  refusalSigningBody,
  stateAfterAsk,
  type AskJudges
} from './ask-for-record'

const ASKED_AT = '2026-09-28T21:00:00Z'
const NONCE = 'nonce-of-the-exchange'

function ourRequestedRecord(): Record<string, unknown> {
  const body = fixtureHalfBody({ capsuleId: 'ours-1' })
  const poc = (body.model_attestation as Record<string, Record<string, Record<string, unknown>>>).compute_attestation[
    'x-mesh-poc-v1'
  ]
  poc.role = 'requested'
  poc.client_nonce = NONCE
  return body
}

/** A row still waiting for their record: known peer, nothing received. */
function waitingRow(): PaneCRow {
  return {
    exchange_key: `digest:${FIXTURE_REQUEST_DIGEST}`,
    mine: { state: 'present', record: ourRequestedRecord() },
    theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1', peer_id: FIXTURE_PROVIDER_NODE }
  } as unknown as PaneCRow
}

function signedRefusal(reason: string) {
  const secret = ed25519.utils.randomSecretKey()
  const refusal = { request_digest: 'f'.repeat(64), reason, issued_at: '2026-09-28T21:00:05Z' }
  const sig = ed25519.sign(refusalSigningBody(refusal), secret)
  const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return { ...refusal, key_id: hex(ed25519.getPublicKey(secret)), sig: hex(sig) }
}

const trustingJudges: AskJudges = {
  recomputeIdMatch: async () => true,
  producerSignatureVerifies: () => true
}

describe('askTarget', () => {
  it('names the node that served our request and the nonce both records carry', () => {
    expect(askTarget(ourRequestedRecord())).toEqual({ peerId: FIXTURE_PROVIDER_NODE, nonce: NONCE })
  })

  it('offers nothing without a full peer id or a nonce', () => {
    const noNonce = ourRequestedRecord()
    delete (noNonce.model_attestation as Record<string, Record<string, Record<string, unknown>>>).compute_attestation[
      'x-mesh-poc-v1'
    ].client_nonce
    expect(askTarget(noNonce)).toBeNull()
    expect(askTarget(fixtureHalfBody({ servedBy: 'unknown' }))).toBeNull()
  })
})

describe('askIsOffered', () => {
  const target = { peerId: FIXTURE_PROVIDER_NODE, nonce: NONCE }
  const at = '2026-09-28T20:00:00Z'
  const now = Date.parse(at)

  it('waits for the timeout, then offers the ask on a row whose record has not arrived', () => {
    expect(askIsOffered('open_not_given', target, at, now + ASK_FOR_RECORD_AFTER_MS - 1)).toBe(false)
    expect(askIsOffered('open_not_given', target, at, now + ASK_FOR_RECORD_AFTER_MS)).toBe(true)
    expect(askIsOffered('open_not_held', target, at, now + ASK_FOR_RECORD_AFTER_MS)).toBe(true)
  })

  it('never offers it on a closed or contradicted row, or with no one to ask', () => {
    const late = now + ASK_FOR_RECORD_AFTER_MS
    expect(askIsOffered('closed', target, at, late)).toBe(false)
    expect(askIsOffered('contradicted', target, at, late)).toBe(false)
    expect(askIsOffered('open_not_given', null, at, late)).toBe(false)
  })
})

describe('judgeAskReply', () => {
  it('reads a signed no_such_record as their signed statement that they have no record', async () => {
    const outcome = await judgeAskReply({ kind: 'answer', answer: signedRefusal('no_such_record') }, null, ASKED_AT)
    expect(outcome).toEqual({ kind: 'no_record', at: '2026-09-28T21:00:05Z' })
    expect(stateAfterAsk(waitingRow(), outcome, null)).toEqual({ kind: 'open_absent', date: '2026-09-28T21:00:05Z' })
  })

  it('reads any other signed reason as a signed decline', async () => {
    const outcome = await judgeAskReply({ kind: 'answer', answer: signedRefusal('policy_decline') }, null, ASKED_AT)
    expect(outcome).toEqual({ kind: 'refused', at: '2026-09-28T21:00:05Z', reason: 'policy_decline' })
    expect(stateAfterAsk(waitingRow(), outcome, null).kind).toBe('open_refused')
  })

  it('reads a signed coverage lag as not yet provable: the row stays asked and can ask again', async () => {
    const outcome = await judgeAskReply(
      { kind: 'answer', answer: signedRefusal('coverage_unsatisfiable') },
      null,
      ASKED_AT
    )
    expect(outcome.kind).toBe('no_reply')
    expect(stateAfterAsk(waitingRow(), outcome, null)).toEqual({ kind: 'open_asked', date: ASKED_AT })
  })

  it('never takes a refusal whose signature does not verify', async () => {
    const forged = { ...signedRefusal('no_such_record'), reason: 'policy_decline' }
    const outcome = await judgeAskReply({ kind: 'answer', answer: forged }, null, ASKED_AT)
    expect(outcome.kind).toBe('no_reply')
    expect(stateAfterAsk(waitingRow(), outcome, null)).toEqual({ kind: 'open_asked', date: ASKED_AT })
  })

  it('keeps the row asked, no reply yet, when the other side could not be reached', async () => {
    const outcome = await judgeAskReply({ kind: 'no_answer', message: 'peer unreachable' }, null, ASKED_AT)
    expect(stateAfterAsk(waitingRow(), outcome, null)).toEqual({ kind: 'open_asked', date: ASKED_AT })
  })

  it('closes the row through the gate when their record verifies and cites our half', async () => {
    const theirs = { ...fixtureHalfBody({ capsuleId: 'theirs-1' }), signature: 'aa', key_id: 'bb' }
    const outcome = await judgeAskReply(
      { kind: 'answer', answer: { v: 1, subject_kind: 'correlation', bundles: [{ receipt: theirs }] } },
      FIXTURE_REQUEST_DIGEST,
      ASKED_AT,
      trustingJudges
    )
    expect(outcome.kind).toBe('record')
    const ours = ourRequestedRecord()
    expect(stateAfterAsk(waitingRow(), outcome, ours as never).kind).toBe('closed')
  })

  it('never closes the row on a record whose signature does not verify', async () => {
    const theirs = { ...fixtureHalfBody({ capsuleId: 'theirs-1' }), signature: 'aa', key_id: 'bb' }
    const outcome = await judgeAskReply(
      { kind: 'answer', answer: { v: 1, subject_kind: 'correlation', bundles: [{ receipt: theirs }] } },
      FIXTURE_REQUEST_DIGEST,
      ASKED_AT,
      { ...trustingJudges, producerSignatureVerifies: () => false }
    )
    expect(stateAfterAsk(waitingRow(), outcome, ourRequestedRecord() as never).kind).not.toBe('closed')
  })

  it('reads their record with a different answer as a disagreement', async () => {
    const theirs = {
      ...fixtureHalfBody({ capsuleId: 'theirs-1', responseDigest: 'e'.repeat(64) }),
      signature: 'aa',
      key_id: 'bb'
    }
    const outcome = await judgeAskReply(
      { kind: 'answer', answer: { v: 1, subject_kind: 'correlation', bundles: [{ receipt: theirs }] } },
      FIXTURE_REQUEST_DIGEST,
      ASKED_AT,
      trustingJudges
    )
    expect(stateAfterAsk(waitingRow(), outcome, ourRequestedRecord() as never).kind).toBe('contradicted')
  })
})
