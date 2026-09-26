import { describe, expect, it } from 'vitest'
import {
  deriveRightCellState,
  isAlarmState,
  isAskAction,
  ledgerStateFilterValue,
  rightCellAction,
  rightCellStatusLabel,
  rightCellText,
  type RightCellState,
  type RightCellStateKind
} from '@/features/capsules/lib/exchange-row-state'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import type { PeerRecomputeState } from '@/features/capsules/lib/recompute-identity'

const REQUEST_DIGEST = 'a'.repeat(64)
const RESPONSE_DIGEST = 'b'.repeat(64)

function paneCRow(overrides: Partial<PaneCRow> = {}): PaneCRow {
  return {
    exchange_key: 'exch-1',
    role_tag: 'ASKED',
    header_state: 'ok',
    properties: null,
    has_issue: false,
    mine: { state: 'present', capsule_id: 'mine-1' },
    theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'peer-1' },
    unilateral: false,
    timestamp: '2026-09-08T00:00:00Z',
    ...overrides
  }
}

/** Our own record, carrying the two §6.2/L-G digests CLOSED requires a
 *  peer's fetched record to cite. */
function localRecordWithDigests(): CapsuleRecord {
  return { capsule_id: 'mine-1', effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST } }
}

/** A peer record that actually cites both of `localRecordWithDigests()`'s
 *  digests -- the ONLY peerRecord shape `digestsCiteOurHalf` reads as
 *  CLOSED-eligible. */
function citingPeerRecord(): Record<string, unknown> {
  return {
    capsule_id: 'a'.repeat(64),
    effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST }
  }
}

function fetched(overrides: Partial<PeerRecomputeState> = {}): PeerRecomputeState {
  return {
    status: 'found',
    idMatch: true,
    signatureOk: true,
    peerRecord: { capsule_id: 'a'.repeat(64) },
    fetch: () => {},
    ...overrides
  }
}

const ALL_KINDS: RightCellStateKind[] = [
  'closed',
  'contradicted',
  'open_refused',
  'open_absent',
  'open_asked',
  'open_pending_fetch',
  'open_not_given',
  'open_not_asked'
]

describe('deriveRightCellState — finding 1 (2026-09-23 assessment): CLOSED requires a held artifact', () => {
  it('MUTANT: a peer-asserted id alone (theirs.state !== absent, no fetch) is never CLOSED', () => {
    const row = paneCRow({ theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'peer-1' } })
    expect(deriveRightCellState(row).kind).not.toBe('closed')
    expect(deriveRightCellState(row).kind).toBe('open_pending_fetch')
  })

  it('a real fetch that matches, is signed, AND cites our half by digest -> CLOSED', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ idMatch: true, signatureOk: true, peerRecord: citingPeerRecord() }),
      localRecordWithDigests()
    )
    expect(state.kind).toBe('closed')
  })

  it('a real fetch that does NOT match -> CONTRADICTED, never CLOSED', () => {
    const row = paneCRow()
    expect(deriveRightCellState(row, fetched({ idMatch: false })).kind).toBe('contradicted')
  })

  it('BOUNCE REPRO (finding 1): idMatch true but signatureOk false is NOT CLOSED -- an id match proves nothing without a verified signature over the fetched bytes', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ idMatch: true, signatureOk: false, peerRecord: citingPeerRecord() }),
      localRecordWithDigests()
    )
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('idMatch true, signature verified, but the peer record does not cite our request/response digests (§6.2/L-G) -- NOT CLOSED', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ idMatch: true, signatureOk: true, peerRecord: { capsule_id: 'a'.repeat(64) } }),
      localRecordWithDigests()
    )
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('idMatch true, signature verified, digests cite, but with no localRecord passed at all -- NOT CLOSED (never a fabricated match against nothing)', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ idMatch: true, signatureOk: true, peerRecord: citingPeerRecord() })
    )
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('a fetch still in flight is not evidence of anything -> stays open_pending_fetch', () => {
    const row = paneCRow()
    const state = deriveRightCellState(row, fetched({ status: 'fetching', idMatch: null, peerRecord: null }))
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('a non-digest self-minted peer marker (capsule-chatcmpl-…) is not fetchable -> open_not_given, never pending fetch', () => {
    const row = paneCRow({
      theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1790354430635', peer_id: 'peer-1' }
    })
    expect(deriveRightCellState(row).kind).toBe('open_not_given')
  })

  it('a digest-shaped peer id with no confirmed fetch -> open_pending_fetch (fetchable)', () => {
    const row = paneCRow({
      theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'peer-1' }
    })
    expect(deriveRightCellState(row).kind).toBe('open_pending_fetch')
  })

  it('a fetch that came back not_found is not evidence of a match -> stays open_pending_fetch, never CLOSED', () => {
    const row = paneCRow()
    const state = deriveRightCellState(row, fetched({ status: 'not_found', idMatch: null, peerRecord: null }))
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('a fetch whose id-recompute could not run (idMatch null) is inconclusive, never CLOSED', () => {
    const row = paneCRow()
    const state = deriveRightCellState(row, fetched({ status: 'found', idMatch: null, peerRecord: { x: 1 } }))
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('theirs.state === absent is open_not_asked regardless of any fetch state (no join key exists to fetch from)', () => {
    const row = paneCRow({ theirs: { state: 'absent', capsule_id: null } })
    expect(deriveRightCellState(row, fetched()).kind).toBe('open_not_asked')
  })
})

describe('deriveRightCellState — [mesh-closed-wiring-four-gaps] Seam A3: a locally-held pushed sibling runs the SAME gate as a live fetch', () => {
  // A local sibling (a half the peer PUSHED to us at completion, verified
  // door-side per Seam A2) is surfaced by the sidecar as `theirs.local_sibling`
  // ONLY when it carries the right provenance (`received_from === served_by`
  // AND `signature_ok`) -- that qualification is enforced natively
  // (`capsule_panes_native.rs::local_sibling_cell`, with its own mutant
  // tests). `useLocalSiblingRecompute` then turns a qualifying sibling into a
  // `PeerRecomputeState` of the SAME shape a live fetch produces, and feeds it
  // to the IDENTICAL `deriveRightCellState` gate. These tests build that exact
  // recompute shape and drive the gate, so a mutation to the ONE shared CLOSED
  // predicate flips them whichever source produced the evidence.

  /** The `PeerRecomputeState` `useLocalSiblingRecompute` produces from a
   *  qualifying local sibling: `status: 'found'`, `signatureOk` from the
   *  door's stored verdict, `peerRecord` the sibling's own bytes, `idMatch`
   *  recomputed in-browser. Same object the fetch path feeds the gate. */
  function fromLocalSibling(overrides: Partial<PeerRecomputeState> = {}): PeerRecomputeState {
    return {
      status: 'found',
      idMatch: true,
      signatureOk: true,
      peerRecord: citingPeerRecord(),
      fetch: () => {},
      ...overrides
    }
  }

  it('MUTANT (sibling without provenance -> OPEN): a row with no local_sibling and no fetch is never CLOSED', () => {
    // No local_sibling surfaced (the sidecar dropped it for want of
    // provenance) means no recompute is passed at all -- the row falls through
    // to open_pending_fetch, never CLOSED off an unverified local hold.
    const row = paneCRow()
    expect(row.theirs.local_sibling).toBeUndefined()
    const state = deriveRightCellState(row, undefined, localRecordWithDigests())
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('MUTANT (a sibling WE sealed -> OPEN): a self-sealed sibling never becomes a local_sibling recompute, so the row stays OPEN', () => {
    // A sibling we sealed carries no `received_from`, so `local_sibling_cell`
    // (native) never surfaces it and `useLocalSiblingRecompute` returns
    // not_fetched -- modeled here as no recompute reaching the gate. The row
    // must NOT read CLOSED.
    const row = paneCRow()
    const notFetched = fromLocalSibling({ status: 'not_fetched', idMatch: null, signatureOk: null, peerRecord: null })
    const state = deriveRightCellState(row, notFetched, localRecordWithDigests())
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('MUTANT (provenance ok but digests differ -> CONTRADICTED): a verified sibling whose recomputed id does not match the claimed id is CONTRADICTED', () => {
    // The sibling verified door-side (signature_ok true) but its own bytes do
    // not produce the capsule_id claimed for them -- the "both present,
    // disagreeing" case. Same gate outcome as a fetch with idMatch false.
    const row = paneCRow()
    const state = deriveRightCellState(row, fromLocalSibling({ idMatch: false }), localRecordWithDigests())
    expect(state.kind).toBe('contradicted')
  })

  it('a verified, id-matching, digest-citing local sibling -> CLOSED, with NO live fetch run', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fromLocalSibling({ idMatch: true, signatureOk: true, peerRecord: citingPeerRecord() }),
      localRecordWithDigests()
    )
    expect(state.kind).toBe('closed')
  })

  it('a local sibling that id-matches and cites, but whose stored signature_ok is not true -> NOT CLOSED (the door never wrote signature_ok:true for an unverified push)', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fromLocalSibling({ idMatch: true, signatureOk: false, peerRecord: citingPeerRecord() }),
      localRecordWithDigests()
    )
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('a verified, id-matching local sibling that does NOT cite our request/response digests -> NOT CLOSED (§6.2/L-G holds for a pushed half too)', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fromLocalSibling({ idMatch: true, signatureOk: true, peerRecord: { capsule_id: 'a'.repeat(64) } }),
      localRecordWithDigests()
    )
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })
})

describe('deriveRightCellState — bilateral-retention-decay-property (agent-action-capsule @7f8a78d8, Steven-ratified 2026-09-23): one-half-unavailable MUST NOT collapse into both-present-disagreeing', () => {
  it('a peer fetch that legitimately comes back not_found (their retention decayed the record away, or they never held it) renders OPEN — never CONTRADICTED, never CLOSED/"attested by both"', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ status: 'not_found', idMatch: null, signatureOk: null, peerRecord: null })
    )
    expect(state.kind).not.toBe('contradicted')
    expect(state.kind).not.toBe('closed')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('an errored peer fetch (transport/verification failure, not a disagreement) renders OPEN — never CONTRADICTED', () => {
    const row = paneCRow()
    const state = deriveRightCellState(
      row,
      fetched({ status: 'error', idMatch: null, signatureOk: null, peerRecord: null })
    )
    expect(state.kind).not.toBe('contradicted')
    expect(state.kind).toBe('open_pending_fetch')
  })

  it('MUTANT: only an ACTUAL fetched-and-compared idMatch===false is CONTRADICTED — every other "half unavailable" shape (not_fetched, fetching, not_found, error, or a fetch whose own id-recompute could not run) must go red if it starts reading as CONTRADICTED', () => {
    const row = paneCRow()
    const unavailableShapes: PeerRecomputeState[] = [
      fetched({ status: 'not_fetched', idMatch: null, signatureOk: null, peerRecord: null }),
      fetched({ status: 'fetching', idMatch: null, signatureOk: null, peerRecord: null }),
      fetched({ status: 'not_found', idMatch: null, signatureOk: null, peerRecord: null }),
      fetched({ status: 'error', idMatch: null, signatureOk: null, peerRecord: null }),
      fetched({ status: 'found', idMatch: null, signatureOk: null, peerRecord: { x: 1 } })
    ]
    for (const recompute of unavailableShapes) {
      expect(deriveRightCellState(row, recompute).kind).not.toBe('contradicted')
    }
    // The one and only shape that IS a real disagreement: a completed
    // fetch whose recomputed id demonstrably does not match the peer's
    // own claimed id -- the "both-present-disagreeing" case the property
    // says MUST stay a contradiction, never downgraded to missing-half.
    expect(deriveRightCellState(row, fetched({ status: 'found', idMatch: false })).kind).toBe('contradicted')
  })
})

describe('deriveRightCellState — all seven states reachable', () => {
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

  it('every one of the seven kinds is reachable', () => {
    const reached = new Set<RightCellStateKind>()
    reached.add(
      deriveRightCellState(
        paneCRow(),
        fetched({ idMatch: true, signatureOk: true, peerRecord: citingPeerRecord() }),
        localRecordWithDigests()
      ).kind
    )
    reached.add(deriveRightCellState(paneCRow(), fetched({ idMatch: false })).kind)
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
    reached.add(
      deriveRightCellState(paneCRow({ theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'p' } }))
        .kind
    )
    reached.add(
      deriveRightCellState(
        paneCRow({ theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1', peer_id: 'p' } })
      ).kind
    )
    reached.add(deriveRightCellState(paneCRow({ theirs: { state: 'absent', capsule_id: null } })).kind)
    for (const kind of ALL_KINDS) expect(reached.has(kind)).toBe(true)
    expect(reached.size).toBe(8)
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

  it('LOAD-BEARING: pending-fetch never renders the same string as not-asked or CLOSED', () => {
    const pendingFetch = rightCellText(stateOf('open_pending_fetch'))
    expect(pendingFetch).not.toBe(rightCellText(stateOf('open_not_asked')))
    expect(pendingFetch).not.toBe(rightCellText(stateOf('closed')))
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
  it('names seven distinct status badges (open_not_given and open_not_asked share the plain OPEN badge)', () => {
    const labels = ALL_KINDS.map((kind) => rightCellStatusLabel(stateOf(kind)))
    expect(new Set(labels).size).toBe(7)
    expect(labels).toEqual([
      'CLOSED',
      'CONTRADICTED',
      'OPEN · refused',
      'OPEN · absent',
      'OPEN · asked',
      'OPEN · pending fetch',
      'OPEN',
      'OPEN'
    ])
  })
})

describe('rightCellAction', () => {
  it('closed, open_pending_fetch, and open_not_given have no row-level action; every other state has one', () => {
    expect(rightCellAction(stateOf('closed'))).toBeNull()
    expect(rightCellAction(stateOf('open_pending_fetch'))).toBeNull()
    expect(rightCellAction(stateOf('open_not_given'))).toBeNull()
    for (const kind of ALL_KINDS.filter(
      (k) => k !== 'closed' && k !== 'open_pending_fetch' && k !== 'open_not_given'
    )) {
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

describe('isAskAction — [ledger-T1-ask-half-action] counterparty-gating predicate', () => {
  it('only open_not_asked and open_asked are ask actions -- open_pending_fetch is a FETCH action, not an ask', () => {
    expect(isAskAction('open_not_asked')).toBe(true)
    expect(isAskAction('open_asked')).toBe(true)
    expect(isAskAction('open_pending_fetch')).toBe(false)
    for (const kind of ALL_KINDS.filter((k) => k !== 'open_not_asked' && k !== 'open_asked')) {
      expect(isAskAction(kind)).toBe(false)
    }
  })
})

describe('ledgerStateFilterValue — v3 §2a toolbar buckets', () => {
  it('closed and contradicted map to themselves', () => {
    expect(ledgerStateFilterValue(stateOf('closed'))).toBe('closed')
    expect(ledgerStateFilterValue(stateOf('contradicted'))).toBe('contradicted')
  })

  it('open_asked (a real ask, no reply yet) gets its own asked_no_reply bucket', () => {
    expect(ledgerStateFilterValue(stateOf('open_asked', '3 Sep'))).toBe('asked_no_reply')
  })

  it('the four no-reply/no-fetch states collapse into the broader open bucket', () => {
    expect(ledgerStateFilterValue(stateOf('open_refused'))).toBe('open')
    expect(ledgerStateFilterValue(stateOf('open_absent'))).toBe('open')
    expect(ledgerStateFilterValue(stateOf('open_pending_fetch'))).toBe('open')
    expect(ledgerStateFilterValue(stateOf('open_not_asked'))).toBe('open')
  })
})
