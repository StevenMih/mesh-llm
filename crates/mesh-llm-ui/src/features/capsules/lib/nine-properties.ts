// The ten-property assurance map's labels (still named NINE_PROPERTY_LABELS
// for historical/import-site continuity -- [mesh-ledger-b5-security-view]
// added `task_binding`, the manifesto's tenth-named-but-ninth-record-check,
// which this map had been shipping without: 8+1, not 9+1), shared between
// LedgerCard (the Peers/Balance card chip strip) and the Exchanges table's
// Checks column ([mesh-ledger-phase3-tables-and-modal] Part 3) so the two
// never drift into different wording for the same properties -- verbatim
// order from `manifesto-the-tenth-check-v6`'s table.
export const NINE_PROPERTY_LABELS: Record<string, string> = {
  content_binding: 'content binding',
  producer_signature: 'producer signature',
  task_binding: 'task binding',
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
