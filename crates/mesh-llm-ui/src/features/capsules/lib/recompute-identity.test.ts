// [mesh-closed-wiring-four-gaps] Seam A3 -- `useLocalSiblingRecompute`
// builds a `PeerRecomputeState` from a row's `theirs.local_sibling` (a
// capsule already held locally, received via record-push and identity-
// verified DOOR-SIDE before it was ever stored). No network call: this is
// the local-evidence half of the CLOSED gate, feeding the SAME
// `deriveRightCellState` the peer-fetch path already uses (exercised
// end-to-end below, proving there is only one shared gate).
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { deriveRightCellState } from '@/features/capsules/lib/exchange-row-state'
import { recomputeCapsuleId } from '@/features/capsules/lib/canonical'
import { useLocalSiblingRecompute } from '@/features/capsules/lib/recompute-identity'

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

describe('useLocalSiblingRecompute', () => {
  it('reports not_fetched when the row carries no local_sibling', () => {
    const row = paneCRow({ theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'peer-1' } })
    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    expect(result.current.status).toBe('not_fetched')
    expect(result.current.idMatch).toBeNull()
    expect(result.current.signatureOk).toBeNull()
    expect(result.current.peerRecord).toBeNull()
  })

  it('resolves found with a real recomputed idMatch when the sibling record actually produces the claimed id', async () => {
    const siblingRecord = { effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST } }
    const realId = await recomputeCapsuleId(siblingRecord)
    const row = paneCRow({
      theirs: {
        state: 'NOT_CHECKED',
        capsule_id: realId,
        peer_id: 'peer-3',
        local_sibling: { capsule_id: realId, received_from: 'peer-3', signature_ok: true, record: siblingRecord }
      }
    })

    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    await waitFor(() => expect(result.current.status).toBe('found'))
    expect(result.current.idMatch).toBe(true)
    expect(result.current.signatureOk).toBe(true)
    expect(result.current.peerRecord).toEqual(siblingRecord)
  })

  // MUTANT: the required "provenance ok but digests differ -> CONTRADICTED"
  // behavior starts here -- a sibling whose OWN bytes do not recompute to
  // the capsule_id it claims must resolve idMatch: false, never true.
  it('resolves found with idMatch false when the sibling record does not recompute to its claimed id', async () => {
    const siblingRecord = { effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST } }
    const wrongId = 'f'.repeat(64) // deliberately not what siblingRecord recomputes to
    const row = paneCRow({
      theirs: {
        state: 'NOT_CHECKED',
        capsule_id: wrongId,
        peer_id: 'peer-3',
        local_sibling: { capsule_id: wrongId, received_from: 'peer-3', signature_ok: true, record: siblingRecord }
      }
    })

    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    await waitFor(() => expect(result.current.status).toBe('found'))
    expect(result.current.idMatch).toBe(false)
  })

  it('never upgrades signatureOk to true when the provenance itself carries false', async () => {
    const siblingRecord = { effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST } }
    const realId = await recomputeCapsuleId(siblingRecord)
    const row = paneCRow({
      theirs: {
        state: 'NOT_CHECKED',
        capsule_id: realId,
        peer_id: 'peer-3',
        local_sibling: { capsule_id: realId, received_from: 'peer-3', signature_ok: false, record: siblingRecord }
      }
    })

    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    await waitFor(() => expect(result.current.status).toBe('found'))
    expect(result.current.signatureOk).toBe(false)
  })
})

describe('local-sibling end-to-end through the SAME deriveRightCellState gate the fetch path uses', () => {
  // [mesh-closed-wiring-four-gaps] required mutant: provenance-verified,
  // id-matching, digest-citing local sibling -> CLOSED, through the
  // UNCHANGED deriveRightCellState -- proves "one shared code path, never a
  // second CLOSED predicate."
  it('a fully-verified local sibling that cites our half closes the row', async () => {
    const siblingRecord = {
      effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST }
    }
    const realId = await recomputeCapsuleId(siblingRecord)
    const row = paneCRow({
      theirs: {
        state: 'NOT_CHECKED',
        capsule_id: realId,
        peer_id: 'peer-3',
        local_sibling: { capsule_id: realId, received_from: 'peer-3', signature_ok: true, record: siblingRecord }
      }
    })
    const localRecord = {
      capsule_id: 'mine-1',
      effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST }
    }

    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    await waitFor(() => expect(result.current.status).toBe('found'))

    const state = deriveRightCellState(row, result.current, localRecord)
    expect(state.kind).toBe('closed')
  })

  // MUTANT: same shape, but the sibling's own bytes don't recompute to the
  // id it claims -> CONTRADICTED, never CLOSED -- through the identical gate.
  it('a local sibling whose bytes contradict its claimed id contradicts the row, never closes it', async () => {
    const siblingRecord = { effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST } }
    const wrongId = 'f'.repeat(64)
    const row = paneCRow({
      theirs: {
        state: 'NOT_CHECKED',
        capsule_id: wrongId,
        peer_id: 'peer-3',
        local_sibling: { capsule_id: wrongId, received_from: 'peer-3', signature_ok: true, record: siblingRecord }
      }
    })
    const localRecord = {
      capsule_id: 'mine-1',
      effect: { request_digest: REQUEST_DIGEST, response_digest: RESPONSE_DIGEST }
    }

    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    await waitFor(() => expect(result.current.status).toBe('found'))

    const state = deriveRightCellState(row, result.current, localRecord)
    expect(state.kind).toBe('contradicted')
  })

  // MUTANT: required "sibling without provenance -> OPEN" -- no
  // `local_sibling` on the row at all (e.g. a capsule this node sealed
  // itself, or one the host never found a matching provenance record for)
  // -> the hook reports not_fetched -> deriveRightCellState falls through to
  // its existing open_pending_fetch/open_not_given path, never CLOSED.
  it('a row with no local_sibling never closes through this path', () => {
    const row = paneCRow({ theirs: { state: 'NOT_CHECKED', capsule_id: 'a'.repeat(64), peer_id: 'peer-1' } })
    const { result } = renderHook(() => useLocalSiblingRecompute(row))
    const state = deriveRightCellState(row, result.current, null)
    expect(state.kind).not.toBe('closed')
    expect(state.kind).not.toBe('contradicted')
  })
})
