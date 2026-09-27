// The host's local peer blocks (`/api/peer-blocks`,
// crates/mesh-llm-host-runtime/src/api/routes/peer_blocks.rs): which peers this
// node's operator stopped routing to, and the record of each block and unblock.
// Loopback-only on the host, like the rest of the operator's controls.
import { env } from '@/lib/env'
import type { PeerBlocksJson, PeerRoutingChangeJson } from '@/features/capsules/lib/peer-routing-view'

const BASE = `${env.managementApiUrl}/api/peer-blocks`

export class PeerBlocksError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new PeerBlocksError(response.status, text || `HTTP ${response.status}`)
  }
  return (await response.json()) as T
}

export async function fetchPeerBlocks(): Promise<PeerBlocksJson> {
  return readJson<PeerBlocksJson>(await fetch(BASE))
}

export type BlockLength = 'seven_days' | 'until_undone'

export async function blockPeer(peer: string, length: BlockLength): Promise<PeerRoutingChangeJson> {
  return readJson<PeerRoutingChangeJson>(
    await fetch(BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peer, length })
    })
  )
}

export async function unblockPeer(peer: string): Promise<PeerRoutingChangeJson> {
  return readJson<PeerRoutingChangeJson>(
    await fetch(`${BASE}/unblock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peer })
    })
  )
}
