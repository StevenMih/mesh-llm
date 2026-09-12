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
// Pane B ("Peers") -- peer_accountability_tab.build_peers_payload. Field
// names below are read verbatim from `peer_accountability_tab.py` (build_
// peer_row / the *_cell functions) on capsule-emit-mesh main -- do not
// invent columns that function doesn't emit. Loose/optional per this file's
// own discipline: an unrecognised field degrades to `undefined`, not a
// parse failure.
// ---------------------------------------------------------------------------

/** `node_cell`. */
export type PaneBNodeCell = PaneState & {
  peer_id?: string | null
  member_kind?: string | null
  exchange_count?: number
}

/** `rung_cell`. `rung`/`distinct_rungs` are the raw ladder values
 *  (`unilateral_fallback` | `acknowledged_receipt` | `full_bilateral`) --
 *  never render the word "rung" itself (ledger grep gate). */
export type PaneBRungCell = PaneState & {
  rung?: string
  distinct_rungs?: string[]
}

/** `role_and_count_cell`. Direction-of-exchange fact, never a trust signal. */
export type PaneBRoleCell = PaneState & {
  role?: 'both' | 'you_to_them' | 'them_to_you' | 'unknown'
  you_to_them_count?: number
  them_to_you_count?: number
  exchange_count?: number
}

/** `peer_history_cell` ("History (theirs)"). Honestly NOT_CHECKED by
 *  default (no peer-fetch carrier wired on most sidecars yet) --
 *  `history_summary` only appears when `peer_fetch_result.status ===
 *  'verified'`. `mine_for_reference` is THIS node's own chain, carried
 *  along for reference only -- never presented as though it were the
 *  peer's. */
export type PaneBHistoryCell = PaneState & {
  fetch_source?: string
  history_summary?: {
    verified_bundles?: number | string
    checkpoint_count?: number | string
    [key: string]: unknown
  }
  mine_for_reference?: {
    history?: PaneState & { history_depth?: number; checkpoint_count?: number; cadence?: Record<string, unknown> }
    continuity?: PaneState & { unforked?: boolean }
    witnessed?: PaneState & { witnesses?: string[] }
    [key: string]: unknown
  } | null
}

/** `served_cell` ("Served (theirs)"). Same peer-fetch-gap discipline as
 *  `history`. */
export type PaneBServedCell = PaneState & {
  source?: string
  served_summary?: {
    n_served?: number | string
    n_completed?: number | string
    n_failed?: number | string
    [key: string]: unknown
  }
  mine_for_reference?: unknown
}

/** `pair_cell` ("Pair (me<->them)") -- digest reconciliation, real. The
 *  only cell that can say "missing" (a lone half with nothing to reconcile
 *  against). */
export type PaneBPairCell = PaneState & {
  verified?: number
  failed?: number
  missing?: number
  details?: Array<{ exchange_id: string; state: string }>
}

/** `verdicts_cell`. `tally` is real only for adjudications THIS node
 *  itself sealed -- "held by others" half is a separate pending reason.
 *  Never render `tally` without also stating the denominator it came
 *  from (`exchange_count`). */
export type PaneBVerdictsCell = PaneState & {
  tally?: { corroborated: number; contradicted: number; inconclusive: number }
  adjudication_capsule_id?: string
  references_tally?: { corroborated: number; contradicted: number; inconclusive: number }
  references_asked?: number
  references_answered?: number
}

/** `asked_cell` -- evidence requests THIS node sent to this peer. Absent
 *  by default (no send-log carrier yet on most sidecars). */
export type PaneBAskedCell = PaneState & {
  count?: number
  send_log?: unknown[]
}

export type PaneBRow = {
  peer_id: string | null
  node: PaneBNodeCell
  rung: PaneBRungCell
  role: PaneBRoleCell
  history: PaneBHistoryCell
  served: PaneBServedCell
  pair: PaneBPairCell
  verdicts: PaneBVerdictsCell
  asked: PaneBAskedCell
  exchange_count: number
  first_seen: string | null
  last_seen: string | null
  expand?: {
    pair_ledger?: Array<{ exchange_id: string; state: string }>
    their_card?: PaneState
  }
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

/** The four evidence-request outcomes named in the two-sided-ledger design
 *  note (v3 §2's "evidence" column) -- see `exchange-row-state.ts`. Optional
 *  because the carrier that would populate it is still unwired end-to-end
 *  (`evidence_responder.py`: "not yet reachable over the wire") -- an
 *  absent value degrades to `not_asked`, never a guess at one of the other
 *  three. */
export type EvidenceRequestOutcome = 'signed_refusal' | 'recorded_absence' | 'unanswered' | 'not_asked'

export type PaneCRow = {
  exchange_key: string
  role_tag: string
  header_state: string
  properties: AssuranceProperties | null
  has_issue: boolean
  mine: {
    state: string
    capsule_id: string | null
    role?: string
    text?: string
    /** What the counterparty streamed back to you -- held only on the
     *  requester's side ([mesh-ledger-b4-toggle-content], v3 §3: "both
     *  halves of the conversation are on the left, because both passed
     *  through you"). Optional/forward-looking: no sidecar emits it yet,
     *  degrades to omitting the second half rather than inventing one. */
    reply_text?: string
    reply_capsule_id?: string | null
    /** L-D: the requester's own copy of populated content, deleted locally.
     *  Only meaningful when `role_tag === 'ASKED'` -- a SERVED row's `mine`
     *  side was never populated to begin with (L-F). */
    deleted?: boolean
    deleted_date?: string | null
  }
  theirs: {
    state: string
    capsule_id: string | null
    role?: string
    text?: string
    evidence_outcome?: EvidenceRequestOutcome
    evidence_outcome_date?: string | null
  }
  unilateral: boolean
  timestamp: string | null
  /** The conversation this exchange belongs to, when this node was the
   *  requester (v3 §2 L-O: a served row structurally has none -- this node
   *  was never party to the requester's session). Optional/forward-looking:
   *  no sidecar emits it yet, so it degrades to `null` (no rail), never an
   *  invented grouping. */
  session_id?: string | null
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
