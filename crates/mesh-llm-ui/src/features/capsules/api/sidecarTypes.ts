// Loose types over the capsule-emit-mesh sidecar's `GET /accountability/
// pane-a|b|c` JSON ([mesh-live-tab-pane-proxy] L1, `accountability_pane_
// routes.py`) -- byte-for-byte the same payloads `capsule_accountability_
// tab.build_tab_payload` / `peer_accountability_tab.build_peers_payload` /
// `capsule_exchange_tab.build_exchange_list_payload`/`build_exchange_view`
// already produce, so these mirror THOSE shapes, not a new one. Deliberately
// permissive (optional/unknown-tolerant), same discipline as
// `api/types.ts`'s `CapsuleRecord` -- an unrecognised or absent field
// degrades to `undefined`, never a parse failure.
import type { CapsuleRecord, JsonRecord } from '@/features/capsules/api/types'

export type PaneState = { state: string; text?: string | null; [key: string]: unknown }

// ---------------------------------------------------------------------------
// Pane A ("This node") -- capsule_accountability_tab.build_tab_payload
// ---------------------------------------------------------------------------

export type PaneARow = {
  capsule_id: string
  timestamp: string | null
  model_claimed: string | null
  hardware_claimed: string | null
  verify_ok: boolean | null
  rungs: Record<string, PaneState>
  record: CapsuleRecord
}

export type PaneAJson = {
  operator: string | null
  witness_checkpoint_supplied: boolean
  rows: PaneARow[]
  card: JsonRecord | null
}

// ---------------------------------------------------------------------------
// Pane B ("Peers") -- peer_accountability_tab.build_peers_payload
// ---------------------------------------------------------------------------

export type PaneBRow = {
  peer_id: string
  node: PaneState
  rung: PaneState
  history: PaneState
  served: PaneState
  verdicts: PaneState
  [key: string]: unknown
}

export type PaneBJson = {
  peer_count: number
  rows: PaneBRow[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Pane C ("This exchange") -- capsule_exchange_tab.build_exchange_list_
// payload / build_exchange_view. The nine-property assurance map
// (`properties`) is the ONLY pane surface that carries the five-state chip
// strip today -- Pane A/B's `rungs`/cell states above are still the older
// per-rung ladder vocabulary (tone-compatible, not chip-shaped).
// ---------------------------------------------------------------------------

export type AssuranceProperties = Record<string, PaneState>

export type PaneCRow = {
  exchange_key: string
  role_tag: string
  header_state: string
  properties: AssuranceProperties | null
  has_issue: boolean
  mine: { state: string; capsule_id: string | null; role?: string; text?: string }
  theirs: { state: string; capsule_id: string | null; role?: string; text?: string }
  unilateral: boolean
  timestamp: string | null
}

export type PaneCListJson = {
  row_count: number
  default_sort: string
  filters: string[]
  rows: PaneCRow[]
  next_after_seq: number | null
  archived_segments: unknown[]
}

export type PaneCDrilldownJson =
  | { exchange_key: string; found: false }
  | { exchange_key: string; found: true; view: JsonRecord & { properties?: AssuranceProperties; capsule_id?: string } }
