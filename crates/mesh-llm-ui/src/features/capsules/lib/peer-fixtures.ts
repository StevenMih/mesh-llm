// Harness fixtures for the Peers tab ([mesh-ledger-peers-tab] Phase 1) --
// so `pnpm dev` (:5173, harness data mode) renders a populated Peers
// column without a live sidecar/mesh. Two rows, matching the acceptance
// check: one clean peer, one peer carrying an alarm (a contradicted
// adjudication AND a failed chain-continuity check). Field shapes mirror
// `peer_accountability_tab.build_peer_row` on capsule-emit-mesh main
// verbatim -- see `sidecarTypes.ts`'s Pane B cell types.
import type { ModelSummary, Peer } from '@/features/app-tabs/types'
import type { PaneBJson, PaneBRow } from '@/features/capsules/api/sidecarTypes'

const CLEAN_PEER_ID = 'node:aa11bb22cc33dd44'
const ALARMED_PEER_ID = 'node:ff99ee88dd77cc66'

const CLEAN_PEER_ROW: PaneBRow = {
  peer_id: CLEAN_PEER_ID,
  node: {
    state: 'present',
    text: CLEAN_PEER_ID,
    peer_id: CLEAN_PEER_ID,
    member_kind: 'member',
    exchange_count: 24
  },
  rung: {
    state: 'present',
    text: 'full_bilateral',
    rung: 'full_bilateral',
    distinct_rungs: ['full_bilateral']
  },
  role: {
    state: 'present',
    text: 'both · 24 (16 you→them, 8 them→you)',
    role: 'both',
    you_to_them_count: 16,
    them_to_you_count: 8,
    exchange_count: 24
  },
  history: {
    state: 'verified',
    text: '5 bundle(s) verified, 41 checkpoint(s) (their count)',
    fetch_source: 'peer_evidence_client',
    history_summary: { verified_bundles: 5, checkpoint_count: 41 }
  },
  served: {
    state: 'NOT_CHECKED',
    text: "this node cannot fetch the peer's OWN served summary yet",
    source: 'self_derived'
  },
  pair: {
    state: 'verified',
    text: '16 pair(s) reconciled, 0 missing',
    verified: 16,
    failed: 0,
    missing: 0,
    details: Array.from({ length: 16 }, (_, i) => ({
      exchange_id: `exch-clean-${String(i).padStart(2, '0')}`,
      state: 'verified'
    }))
  },
  verdicts: {
    state: 'present',
    text: '8 corroborated, 0 contradicted, 0 inconclusive (self-sealed)',
    tally: { corroborated: 8, contradicted: 0, inconclusive: 0 },
    source: 'self_sealed'
  },
  asked: { state: 'absent', text: "this node doesn't persist a send log yet", count: 0 },
  exchange_count: 24,
  first_seen: '2026-08-20T09:12:00Z',
  last_seen: '2026-09-08T16:58:05Z',
  expand: {
    pair_ledger: Array.from({ length: 16 }, (_, i) => ({
      exchange_id: `exch-clean-${String(i).padStart(2, '0')}`,
      state: 'verified'
    })),
    their_card: { state: 'NOT_CHECKED', text: "this node cannot fetch the peer's OWN history card yet" }
  }
}

const ALARMED_PEER_ROW: PaneBRow = {
  peer_id: ALARMED_PEER_ID,
  node: {
    state: 'present',
    text: ALARMED_PEER_ID,
    peer_id: ALARMED_PEER_ID,
    member_kind: 'member',
    exchange_count: 14
  },
  rung: {
    state: 'present',
    text: 'acknowledged_receipt',
    rung: 'acknowledged_receipt',
    distinct_rungs: ['acknowledged_receipt', 'full_bilateral']
  },
  role: {
    state: 'present',
    text: 'both · 14 (10 you→them, 4 them→you)',
    role: 'both',
    you_to_them_count: 10,
    them_to_you_count: 4,
    exchange_count: 14
  },
  history: {
    state: 'failed',
    text: 'fetch verification failed: chain diverged from the last checkpoint this node verified',
    mine_for_reference: {
      history: {
        state: 'verified',
        text: '9 checkpoint(s) since size 0',
        history_depth: 9,
        checkpoint_count: 9,
        cadence: {}
      },
      continuity: { state: 'failed', text: 'broken at mmr_size=32', unforked: false },
      witnessed: { state: 'absent', text: 'not witnessed', witnesses: [] }
    }
  },
  served: {
    state: 'NOT_CHECKED',
    text: "this node cannot fetch the peer's OWN served summary yet",
    source: 'self_derived'
  },
  pair: {
    state: 'failed',
    text: '1 pair(s) digest-mismatched, 9 reconciled',
    verified: 9,
    failed: 1,
    missing: 0,
    details: [
      { exchange_id: 'exch-alarm-07', state: 'failed' },
      ...Array.from({ length: 9 }, (_, i) => ({
        exchange_id: `exch-alarm-${String(i).padStart(2, '0')}`,
        state: 'verified'
      }))
    ]
  },
  verdicts: {
    state: 'contradicted',
    text: '6 corroborated, 1 contradicted, 0 inconclusive (self-sealed)',
    tally: { corroborated: 6, contradicted: 1, inconclusive: 0 },
    adjudication_capsule_id: 'cap-alarmed-adjudication-0007',
    source: 'self_sealed'
  },
  asked: { state: 'absent', text: "this node doesn't persist a send log yet", count: 0 },
  exchange_count: 14,
  first_seen: '2026-08-25T11:40:00Z',
  last_seen: '2026-09-08T08:03:00Z',
  expand: {
    pair_ledger: [
      { exchange_id: 'exch-alarm-07', state: 'failed' },
      ...Array.from({ length: 9 }, (_, i) => ({
        exchange_id: `exch-alarm-${String(i).padStart(2, '0')}`,
        state: 'verified'
      }))
    ],
    their_card: { state: 'NOT_CHECKED', text: "this node cannot fetch the peer's OWN history card yet" }
  }
}

export const HARNESS_PANE_B_PAYLOAD: PaneBJson = {
  peer_count: 2,
  default_sort: 'last_seen',
  rows: [CLEAN_PEER_ROW, ALARMED_PEER_ROW]
}

// Model names/quant/ctx match `dashboard-fixtures.ts`'s `MODELS` entries
// verbatim so the Chat harness catalog actually contains what "Route here"
// pre-selects -- otherwise the dropdown would fall back to Auto in harness
// mode even though the search param round-trips correctly.
export const PEER_TAB_HARNESS_MESH_PEERS: Peer[] = [
  {
    id: 'aa11bb22cc33dd44',
    hostname: 'clean-node.local',
    region: 'us-west',
    status: 'online',
    hostedModels: ['Qwen3.6-27B-UD'],
    sharePct: 12,
    latencyMs: 38,
    loadPct: 22,
    shortId: 'aa11bb22'
  },
  {
    id: 'ff99ee88dd77cc66',
    hostname: 'alarmed-node.local',
    region: 'eu-central',
    status: 'online',
    hostedModels: ['Qwen3.6-35B-A3B-UD'],
    sharePct: 6,
    latencyMs: 145,
    loadPct: 61,
    shortId: 'ff99ee88'
  }
]

export const PEER_TAB_HARNESS_MESH_MODELS: ModelSummary[] = [
  {
    name: 'Qwen3.6-27B-UD',
    family: 'Qwen',
    size: '17.8 GB',
    context: '256k',
    status: 'warm',
    tags: [],
    quant: 'Q4_K_XL',
    ctxMaxK: 256
  },
  {
    name: 'Qwen3.6-35B-A3B-UD',
    family: 'Qwen',
    size: '22.1 GB',
    context: '256k',
    status: 'warm',
    tags: [],
    quant: 'Q4_K_XL',
    ctxMaxK: 256
  }
]
