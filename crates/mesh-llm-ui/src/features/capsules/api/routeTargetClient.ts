// Where this console's chats go (`/api/route-target`,
// crates/mesh-llm-host-runtime/src/api/routes/route_target.rs). "Chat with this
// node" sets it; the host then sends every chat from this console to that node
// (as `x-mesh-target`) until it is cleared. Chat's own code is unchanged.
// Loopback-only on the host.
import { env } from '@/lib/env'

const URL = `${env.managementApiUrl}/api/route-target`

type RouteTargetJson = { node_id: string | null }

async function readTarget(response: Response): Promise<string | null> {
  if (!response.ok) throw new Error((await response.text().catch(() => '')) || `HTTP ${response.status}`)
  const body = (await response.json()) as RouteTargetJson
  return typeof body.node_id === 'string' ? body.node_id : null
}

export async function fetchRouteTarget(): Promise<string | null> {
  return readTarget(await fetch(URL))
}

export async function setRouteTarget(nodeId: string): Promise<string | null> {
  return readTarget(
    await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node_id: nodeId })
    })
  )
}

export async function clearRouteTarget(): Promise<string | null> {
  return readTarget(await fetch(URL, { method: 'DELETE' }))
}
