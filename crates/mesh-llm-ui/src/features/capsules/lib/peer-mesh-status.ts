// Joins a Pane B peer_id (capsule-emit-mesh's own counterparty label --
// see `capsule_mesh_view.label_counterparty`) against the Network feature's
// live mesh state (`Peer`/`ModelSummary`, [mesh-ledger-peers-tab]'s "mesh
// status" side of the join: model, quant, native_context_length, latency,
// online). The join key formats don't share a schema across the two
// subsystems, so the match is best-effort with a safe "not available"
// fallback -- never a fabricated status when nothing matches.
import { useMemo } from 'react'
import { useDataMode } from '@/lib/data-mode'
import { adaptModelsToSummary } from '@/features/network/api/models-adapter'
import { adaptStatusToDashboard } from '@/features/network/api/status-adapter'
import { useModelsQuery } from '@/features/network/api/use-models-query'
import { useStatusQuery } from '@/features/network/api/use-status-query'
import type { ModelSummary, Peer } from '@/features/app-tabs/types'

export type PeerMeshStatus = {
  modelName: string | null
  quant: string | null
  contextLengthK: number | null
  latencyMs: number | null
  online: boolean
}

function stripPeerRefPrefix(peerId: string): string {
  const idx = peerId.indexOf(':')
  return idx === -1 ? peerId : peerId.slice(idx + 1)
}

/** Best-effort match: pane-b's `node:<served_by_node_id[:16]>` /
 *  `initiator:<ref>` / `counterparty:<ref>` forms against the Network
 *  feature's `Peer.id` (itself `node_id ?? id ?? hostname` per
 *  `status-adapter.resolvePeerId`). Exact match first, then the bare ref
 *  with/without the pane-b label prefix, then a short-id or id-prefix
 *  match for the truncated `node:` form. */
export function findMeshPeer(peerId: string, peers: readonly Peer[]): Peer | undefined {
  const bare = stripPeerRefPrefix(peerId)
  return (
    peers.find((peer) => peer.id === peerId) ??
    peers.find((peer) => peer.id === bare) ??
    peers.find((peer) => peer.shortId === bare) ??
    (bare.length >= 6 ? peers.find((peer) => peer.id.startsWith(bare)) : undefined)
  )
}

export function deriveMeshStatus(
  peerId: string,
  peers: readonly Peer[],
  models: readonly ModelSummary[]
): PeerMeshStatus | null {
  const peer = findMeshPeer(peerId, peers)
  if (!peer) return null
  const modelName = peer.hostedModels[0] ?? null
  const model = modelName ? models.find((candidate) => candidate.name === modelName) : undefined
  return {
    modelName,
    quant: model?.quant ?? null,
    contextLengthK: model?.ctxMaxK ?? null,
    latencyMs: peer.latencyMs,
    online: peer.status === 'online'
  }
}

export type PeerMeshStatusIndex = { statusFor: (peerId: string) => PeerMeshStatus | null }

/** Live mode: reuses the same `useStatusQuery`/`useModelsQuery` +
 *  adapters the Network Dashboard already calls -- no new endpoint, no
 *  re-derivation of mesh state. Harness mode: uses the fixtures the caller
 *  supplies (kept in `peer-fixtures.ts`, co-located with the matching
 *  pane-b row fixtures so peer_ids line up by construction). */
export function usePeerMeshStatusIndex(
  harnessPeers: readonly Peer[],
  harnessModels: readonly ModelSummary[]
): PeerMeshStatusIndex {
  const { mode } = useDataMode()
  const liveMode = mode === 'live'
  const statusQuery = useStatusQuery({ enabled: liveMode })
  const modelsQuery = useModelsQuery({ enabled: liveMode })

  const liveModels = useMemo(
    () => (modelsQuery.data ? adaptModelsToSummary(modelsQuery.data.mesh_models) : []),
    [modelsQuery.data]
  )
  const liveDashboard = useMemo(
    () => (statusQuery.data ? adaptStatusToDashboard(statusQuery.data, liveModels) : undefined),
    [statusQuery.data, liveModels]
  )

  const peers = useMemo(
    () => (liveMode ? (liveDashboard?.peers ?? []) : harnessPeers),
    [liveMode, liveDashboard, harnessPeers]
  )
  const models = useMemo(() => (liveMode ? liveModels : harnessModels), [liveMode, liveModels, harnessModels])

  return useMemo(() => {
    const cache = new Map<string, PeerMeshStatus | null>()
    return {
      statusFor(peerId: string) {
        if (!cache.has(peerId)) cache.set(peerId, deriveMeshStatus(peerId, peers, models))
        return cache.get(peerId) ?? null
      }
    }
  }, [peers, models])
}
