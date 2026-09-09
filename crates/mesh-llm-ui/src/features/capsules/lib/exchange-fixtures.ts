// Harness fixtures for the Exchanges view ([mesh-ledger-phase3-tables-and-
// modal]) -- so `pnpm dev`/`pnpm preview` (harness data mode) renders the
// balance/coverage header and the exchanges table without a live sidecar.
// Field shapes mirror `capsule_accountability_tab.build_served_summary_
// block`/`served_summary.ServedSummary.to_value` and `capsule_exchange_tab.
// build_exchange_list_payload` verbatim -- see `sidecarTypes.ts`.
import type { PaneAJson } from '@/features/capsules/api/sidecarTypes'
import type { PaneCListJson } from '@/features/capsules/api/sidecarTypes'

export const HARNESS_PANE_A_PAYLOAD: PaneAJson = {
  operator: null,
  witness_checkpoint_supplied: true,
  rows: [],
  card: {
    served_summary: {
      state: 'verified',
      text: 'llama-2-7b: 24 served',
      source: 'self_derived',
      served_summary: {
        schema: 'mesh-served-summary/1',
        node_id: 'node:aa11bb22cc33dd44',
        selection: { from_entry: 1, to_entry: 40, covered_entries: 40, note: 'witnessed range only' },
        derivation: {
          kind: 'served_summary_fold',
          definition_digest: 'sha256:harness-definition-digest',
          by_model: {
            'llama-2-7b': {
              served: 24,
              completed: 22,
              failed: 2,
              refused: 0,
              refused_note: null,
              latency_p50_ms: '812.500',
              latency_p95_ms: '1420.000',
              latency_max_ms: '1980.000',
              weights_digest: { present: 0, absent: 24, note: 'no capsule field named weights_digest exists' },
              quantizations: ['q4_0'],
              floor_applied: false
            }
          },
          note: 'counts + latency distribution per model, over the selected witnessed range'
        },
        coverage: {
          checkpoint_root: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
          mmr_size: 64,
          log_id: 'harness-log',
          timestamp: '2026-09-08T16:58:05Z',
          witnesses: ['https://witness-a.example', 'https://witness-b.example'],
          witnessed: true,
          note: 'cross-check handle'
        },
        adjudications_received: { value: 8, source: 'self_held', note: 'verdicts received about served exchanges' },
        no_requester_identifiers: 'this summary reads and reports no requester-identity field',
        not_a_score: 'An account of facts + a witness handle to verify them, not a score or routing recommendation.'
      }
    }
  }
}

const CLEAN_EXCHANGE_PROPERTIES = {
  content_binding: { state: 'PASS' },
  producer_signature: { state: 'PASS' },
  local_inclusion: { state: 'PASS' },
  checkpoint_signature: { state: 'PASS' },
  external_registration: { state: 'PASS' },
  continuity: { state: 'PASS' },
  identity_authority: { state: 'NOT_PRESENT' },
  capture_coverage: { state: 'PASS' },
  outcome_corroboration: { state: 'PASS' }
}

const EXCEPTION_EXCHANGE_PROPERTIES = {
  content_binding: { state: 'PASS' },
  producer_signature: { state: 'PASS' },
  local_inclusion: { state: 'PASS' },
  checkpoint_signature: { state: 'FAIL', text: 'checkpoint signature could not be verified against the pinned key' },
  external_registration: { state: 'NOT_CHECKED' },
  continuity: { state: 'PASS' },
  identity_authority: { state: 'NOT_PRESENT' },
  capture_coverage: { state: 'NOT_CHECKED' },
  outcome_corroboration: { state: 'NOT_CHECKED' }
}

export const HARNESS_PANE_C_PAYLOAD: PaneCListJson = {
  row_count: 2,
  default_sort: 'timestamp',
  filters: [],
  next_after_seq: null,
  archived_segments: [],
  rows: [
    {
      exchange_key: 'exch-clean-00',
      role_tag: 'ASKED',
      header_state: 'ok',
      properties: CLEAN_EXCHANGE_PROPERTIES,
      has_issue: false,
      mine: { state: 'present', capsule_id: 'mine_exch-clean-00' },
      theirs: { state: 'present', capsule_id: 'theirs_exch-clean-00' },
      unilateral: false,
      timestamp: '2026-09-08T16:58:05Z'
    },
    {
      exchange_key: 'exch-alarm-07',
      role_tag: 'ASKED',
      header_state: 'issue',
      properties: EXCEPTION_EXCHANGE_PROPERTIES,
      has_issue: true,
      mine: { state: 'present', capsule_id: 'mine_exch-alarm-07' },
      theirs: { state: 'absent', capsule_id: null },
      unilateral: true,
      timestamp: '2026-09-08T08:03:00Z'
    }
  ]
}
