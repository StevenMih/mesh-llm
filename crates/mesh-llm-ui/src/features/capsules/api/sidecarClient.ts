// Fetches capsule-emit-mesh's own sidecar HTTP surface directly
// ([mesh-live-tab-pane-proxy] Q2 ruling) -- NOT a mesh-llm host route.
// `crates/mesh-llm-host-runtime`'s `api/routes/capsules.rs` stays static
// `ledger/`-serving; these three routes exist only in the Python sidecar
// (`accountability_pane_routes.py`) because only it can run the
// derivations (rung grading, peer grouping, the nine-property assurance
// map) these payloads carry. Every call is same-origin-optional: the
// sidecar's own CORS allowlist (`--pane-dashboard-origin`) is what actually
// gates a real cross-origin browser fetch; this client just points `fetch`
// at whatever base URL the user configured (`sidecarConfig.ts`).
import type { PaneAJson, PaneBJson, PaneCDrilldownJson, PaneCListJson } from '@/features/capsules/api/sidecarTypes'

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`sidecar pane fetch failed: HTTP ${response.status} (${url})`)
  }
  return (await response.json()) as T
}

export function fetchPaneA(baseUrl: string): Promise<PaneAJson> {
  return getJson<PaneAJson>(`${baseUrl}/accountability/pane-a`)
}

export function fetchPaneB(baseUrl: string): Promise<PaneBJson> {
  return getJson<PaneBJson>(`${baseUrl}/accountability/pane-b`)
}

export function fetchPaneCList(baseUrl: string, opts?: { limit?: number; afterSeq?: number }): Promise<PaneCListJson> {
  const params = new URLSearchParams()
  if (opts?.limit != null) params.set('limit', String(opts.limit))
  if (opts?.afterSeq != null) params.set('after_seq', String(opts.afterSeq))
  const query = params.toString()
  return getJson<PaneCListJson>(`${baseUrl}/accountability/pane-c${query ? `?${query}` : ''}`)
}

export function fetchPaneCDrilldown(baseUrl: string, exchangeId: string): Promise<PaneCDrilldownJson> {
  return getJson<PaneCDrilldownJson>(`${baseUrl}/accountability/pane-c?exchange_id=${encodeURIComponent(exchangeId)}`)
}
