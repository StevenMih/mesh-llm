// Loose types over the mesh capsule JSON shape (draft-mih-scitt-agent-action-
// capsule-02 + the x-mesh-poc-v1 extension). Deliberately permissive --
// mirrors capsule_mesh_viewer.py's tolerance of both real capture shapes --
// so an unrecognised/absent field degrades to `undefined`, never a parse
// failure. The full record always travels alongside (`record` on
// CapsuleEntry) for in-browser capsule_id recompute.

export type JsonRecord = Record<string, unknown>

export type CapsuleRecord = JsonRecord & {
  capsule_id?: string
  timestamp?: string
  operator?: string
  model_attestation?: {
    model_id?: string
    compute_attestation?: {
      'x-mesh-poc-v1'?: JsonRecord
    }
  }
  effect?: {
    request_digest?: string
    response_digest?: string
    effect_attestation?: string
  }
  disposition?: {
    decision?: string
    verdict_class?: string
  }
}

export type ServingProvenance = {
  model: string | null
  quantization: string | null
  architecture: string | null
  parameterSize: string | number | null
  contextLength: string | number | null
  layerCount: string | number | null
  modelIdentityHash: string | null
  modelCanonicalRef: string | null
  gpu: string | null
  vramBytes: number | null
  isSoc: boolean | null
  device: string | null
  hostname: string | null
  servedByNodeId: string | null
  requestingParty: string | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  generationParameters: JsonRecord
}

export type VerdictLine = { mark: 'ok' | 'warn'; text: string }

export type ReconcileField = { advertised: unknown; served: unknown; verdict: string }
export type ReconcileResult = {
  overall: 'match' | 'mismatch' | 'advertisement_absent' | 'no_served_facts'
  advertisementPresent: boolean
  fields: Record<string, ReconcileField>
  mismatches: string[]
}

export type CapsuleLedgerEntry = {
  record: CapsuleRecord
  capsuleId: string
  timestamp: string | null
  sp: ServingProvenance
  friendlyModel: string
}

export type CapsuleLedger = {
  records: CapsuleRecord[]
  nodePubKeyPem: string | null
}

// The OPTIONAL local disclosure preimage a capsule-emit-mesh sidecar writes
// to `<ledger_dir>/disclosures/<capsule_id>.json` (capsule-emit-mesh PR #79,
// `capsule_sidecar.persist_disclosure_preimage`). Never part of the signed
// capsule -- request_body/response_body are the EXACT JSON bodies the sidecar
// digested, so the UI can recompute request_digest/response_digest from them
// in-browser and prove (or disprove) a match against the sealed digests.
export type DisclosurePreimage = {
  capsule_id?: string
  request_body?: JsonRecord
  response_body?: JsonRecord
  request_text?: string | null
  response_text?: string | null
  tool_calls_note?: string | null
}

// Pane A ("This node") of the Accountability tab
// ([mesh-pane-a-self-accountability-tab]). Written by capsule-emit-mesh's
// `self_accountability.py build` CLI to `<ledger_dir>/accountability_self.json`
// and served read-only by the same route as the rest of this ledger dir --
// this shape mirrors that CLI's output exactly, field for field. A property
// graded `state: "absent"` always carries a `reason`; none of these fields
// is, or ever becomes, a score.
export type GradedAbsent = { state: 'absent'; source: null; capture_method: null; reason: string }

export type SelfAccountabilityCard = {
  node_id: string
  sealing: {
    source: string
    capture_method: string
    coverage_summary: string
    unsealed_count: number
    last_sealed: string | null
    failed_sealed: boolean
    unsealed_rows: Array<JsonRecord & { finding?: string }>
  }
  history: {
    source: string
    capture_method: string
    continuous_since: string | null
    checkpoint_count: number
    continuity: string
    unforked: boolean
    witnessed: boolean
    witnesses: string[]
    cadence: JsonRecord
  }
  rung: {
    freshness: { state: string; client_nonce_source: string | null }
    cross_party: { rung: string; identity_limitation: string | null }
    runtime_binding: { state: string }
    weights_digest: GradedAbsent
    identity: {
      source: string
      capture_method: string
      owner_status: string | null
      owner_id: string | null
      identity_limitation: string | null
    }
  }
  shared: {
    cards_served: GradedAbsent
    bundles_served: GradedAbsent
    refusals_issued: GradedAbsent
  }
  adjudications: {
    source: string
    capture_method: string
    corroborated: number
    contradicted: number
    inconclusive: number
  }
  honesty_line: string
}
