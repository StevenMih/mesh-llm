// The nine-property assurance map's labels, shared between LedgerCard (the
// Peers/Balance card chip strip) and the Exchanges table's Checks column
// ([mesh-ledger-phase3-tables-and-modal] Part 3) so the two never drift
// into different wording for the same properties -- verbatim order from
// the spec's §2.
export const NINE_PROPERTY_LABELS: Record<string, string> = {
  content_binding: 'content binding',
  producer_signature: 'producer signature',
  local_inclusion: 'local inclusion',
  checkpoint_signature: 'checkpoint signature',
  external_registration: 'external registration',
  continuity: 'continuity',
  identity_authority: 'identity/authority',
  capture_coverage: 'capture coverage',
  outcome_corroboration: 'outcome corroboration'
}

// These two are ALWAYS recomputed in-browser — never trusted from sidecar.
export const RECOMPUTED_PROPERTIES = new Set(['content_binding', 'producer_signature'])
