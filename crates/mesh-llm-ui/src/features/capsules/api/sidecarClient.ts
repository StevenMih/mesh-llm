// Fetches the capsule-emit-mesh sidecar's accountability pane data through
// the mesh-llm host's own `/api/capsules/panes/*` route
// (`crates/mesh-llm-host-runtime/src/api/routes/capsule_panes.rs`), which
// forwards server-side to the sidecar
// ([mesh-ledger-earned-pass-and-native-panes] Part B -- supersedes
// [mesh-live-tab-pane-proxy] Q2's original "call the sidecar directly from
// the browser" ruling). The host is the only party that needs to know the
// sidecar's location; this client never takes a base URL, and a
// server-to-server forward has no CORS to fail.
import { env } from '@/lib/env'
import type { PaneAJson, PaneBJson, PaneCDrilldownJson, PaneCListJson } from '@/features/capsules/api/sidecarTypes'

const PANES_BASE = `${env.managementApiUrl}/api/capsules/panes`

/** Thrown by `getJson` on a non-2xx response, carrying the HTTP status so
 *  callers can tell "the host's capsule service isn't running" (503) apart
 *  from any other failure. */
export class PaneFetchError extends Error {
  status: number
  constructor(status: number, url: string) {
    super(`pane fetch failed: HTTP ${status} (${url})`)
    this.status = status
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new PaneFetchError(response.status, url)
  }
  return (await response.json()) as T
}

export function fetchPaneA(): Promise<PaneAJson> {
  return getJson<PaneAJson>(`${PANES_BASE}/pane-a`)
}

export function fetchPaneB(): Promise<PaneBJson> {
  return getJson<PaneBJson>(`${PANES_BASE}/pane-b`)
}

export function fetchPaneCList(opts?: { limit?: number; afterSeq?: number }): Promise<PaneCListJson> {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.afterSeq != null) params.set('after_seq', String(opts.afterSeq))
  const query = params.toString()
  return getJson<PaneCListJson>(`${PANES_BASE}/pane-c${query ? `?${query}` : ''}`)
}

export function fetchPaneCDrilldown(exchangeId: string): Promise<PaneCDrilldownJson> {
  return getJson<PaneCDrilldownJson>(`${PANES_BASE}/pane-c?exchange_id=${encodeURIComponent(exchangeId)}`)
}
