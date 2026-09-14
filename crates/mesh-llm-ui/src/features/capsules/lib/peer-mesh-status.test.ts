// [ledger-T7-peers-table] `advertisedOnlyPeers` drives the Peers table's
// second row group -- it must reuse the SAME best-effort matcher
// (`findMeshPeer`) the per-row `deriveMeshStatus` lookup already applies,
// so the group split can never disagree with a row's own status lookup.
import { describe, expect, it } from 'vitest'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import type { Peer } from '@/features/app-tabs/types'
import { advertisedOnlyPeers, deriveMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import { LatencySource } from '@/lib/api/types'

function peer(overrides: Partial<Peer> = {}): Peer {
  return {
    id: 'aa11bb22cc33dd44',
    hostname: 'dealt-with.local',
    region: 'us-west',
    status: 'online',
    hostedModels: [],
    sharePct: 0,
    latencyMs: null,
    loadPct: 0,
    ...overrides
  }
}

function paneBRow(peerId: string): PaneBRow {
  return {
    peer_id: peerId,
    node: { state: 'present', text: peerId },
    rung: { state: 'present', text: 'full_bilateral', rung: 'full_bilateral' },
    role: { state: 'present', text: '', role: 'both', you_to_them_count: 1, them_to_you_count: 1, exchange_count: 2 },
    history: { state: 'NOT_CHECKED', text: null },
    served: { state: 'NOT_CHECKED', text: null },
    pair: { state: 'absent', text: null, verified: 0, failed: 0, missing: 0, details: [] },
    verdicts: { state: 'NOT_CHECKED', text: null, tally: { corroborated: 0, contradicted: 0, inconclusive: 0 } },
    asked: { state: 'absent', text: null, count: 0 },
    exchange_count: 2,
    first_seen: null,
    last_seen: null
  }
}

describe('advertisedOnlyPeers', () => {
  it('excludes every mesh peer a Pane B row matches, keeps every peer with no matching row', () => {
    const dealtWith = peer({ id: 'aa11bb22cc33dd44', shortId: 'aa11bb22' })
    const unused = peer({ id: 'ff99ee88dd77cc66', shortId: 'ff99ee88', hostname: 'unused.local' })
    const rows = [paneBRow('node:aa11bb22cc33dd44')]

    expect(advertisedOnlyPeers(rows, [dealtWith, unused])).toEqual([unused])
  })

  it('is the full mesh peer list when Pane B has no rows at all (never fabricates a dealt-with match)', () => {
    const a = peer({ id: 'aaaaaaaa' })
    const b = peer({ id: 'bbbbbbbb' })
    expect(advertisedOnlyPeers([], [a, b])).toEqual([a, b])
  })

  it('is empty when every mesh peer has a matching row', () => {
    const only = peer({ id: 'aa11bb22cc33dd44' })
    expect(advertisedOnlyPeers([paneBRow('node:aa11bb22cc33dd44')], [only])).toEqual([])
  })
})

describe('deriveMeshStatus — carries latency provenance through the join', () => {
  it('threads latencySource from the matched Peer, never dropping it', () => {
    const status = deriveMeshStatus(
      'node:aa11bb22cc33dd44',
      [peer({ id: 'aa11bb22cc33dd44', latencyMs: 38, latencySource: LatencySource.DIRECT })],
      []
    )
    expect(status?.latencySource).toBe(LatencySource.DIRECT)
  })

  it('degrades to null latencySource, never a fabricated DIRECT, when the peer carries none', () => {
    const status = deriveMeshStatus('node:aa11bb22cc33dd44', [peer({ id: 'aa11bb22cc33dd44' })], [])
    expect(status?.latencySource).toBeNull()
  })
})
