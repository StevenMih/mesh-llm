import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import {
  NINE_PROPERTY_LABELS,
  WHAT_ACTUALLY_HAPPENED_GROUP,
  WHAT_NODE_SAID_GROUP
} from '@/features/capsules/lib/nine-properties'
import type { RecomputedIdentity } from '@/features/capsules/lib/recompute-identity'
import {
  buildChecksRows,
  buildCommitsToRows,
  buildHeaderRows,
  buildIdentityRow
} from '@/features/capsules/lib/security-checks-view'

// The manifesto's ten names, verbatim from `manifesto-the-tenth-check-v6`'s
// table -- the accept test's ground truth (this repo's field names, per
// `NINE_PROPERTY_LABELS`'s own header comment).
const MANIFESTO_TEN_PROPERTY_KEYS = [
  'content_binding',
  'producer_signature',
  'task_binding',
  'local_inclusion',
  'checkpoint_signature',
  'external_registration',
  'continuity',
  'identity_authority',
  'capture_coverage',
  'outcome_corroboration'
]

function paneCRow(overrides: Partial<PaneCRow> = {}): PaneCRow {
  return {
    exchange_key: 'exch-cle',
    role_tag: 'ASKED',
    header_state: 'ok',
    properties: null,
    has_issue: false,
    mine: { state: 'present', capsule_id: 'mine-capsule-1' },
    theirs: { state: 'present', capsule_id: 'theirs-capsule-1' },
    unilateral: false,
    timestamp: '2026-09-08T16:58:05.412Z',
    ...overrides
  }
}

const NOT_RECOMPUTED: RecomputedIdentity = { idMatch: null, signatureOk: null }
const RECOMPUTED_MATCH: RecomputedIdentity = { idMatch: true, signatureOk: true }

describe('buildChecksRows — rendered property set (accept: == manifesto ten names exactly)', () => {
  it('emits exactly the manifesto ten property keys, in order', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    expect(rows.map((r) => r.key)).toEqual(MANIFESTO_TEN_PROPERTY_KEYS)
  })

  it('NINE_PROPERTY_LABELS itself carries all ten (9+1, not 8+1)', () => {
    expect(Object.keys(NINE_PROPERTY_LABELS)).toEqual(MANIFESTO_TEN_PROPERTY_KEYS)
    expect(NINE_PROPERTY_LABELS.task_binding).toBe('task binding')
  })

  it('every row but outcome_corroboration is grouped "what this node said it did"; outcome_corroboration alone is "what actually happened"', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    for (const key of MANIFESTO_TEN_PROPERTY_KEYS) {
      if (key === 'outcome_corroboration') {
        expect(byKey[key].group).toBe(WHAT_ACTUALLY_HAPPENED_GROUP)
      } else {
        expect(byKey[key].group).toBe(WHAT_NODE_SAID_GROUP)
      }
    }
  })
})

describe('buildChecksRows — Q1: five results render lowercase, never shouty caps', () => {
  it('established/failed/not present/not checked/inconclusive, not PASS/FAIL/...', () => {
    const row = paneCRow({
      properties: {
        task_binding: { state: 'PASS' },
        local_inclusion: { state: 'FAIL' },
        checkpoint_signature: { state: 'PASS' },
        external_registration: { state: 'NOT_CHECKED' },
        continuity: { state: 'INCONCLUSIVE' }
      }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.task_binding.yours?.label).toBe('established')
    expect(byKey.local_inclusion.yours?.label).toBe('failed')
    expect(byKey.checkpoint_signature.yours?.label).toBe('established')
    expect(byKey.external_registration.yours?.label).toBe('not checked')
    expect(byKey.continuity.yours?.label).toBe('inconclusive')
    for (const r of rows) {
      if (r.yours) expect(r.yours.label).not.toMatch(/[A-Z]/)
    }
  })
})

describe('buildChecksRows — checkpoint-dependent properties resolve NOT_PRESENT, never NOT_CHECKED, when absent', () => {
  it('local_inclusion/checkpoint_signature/continuity default to not present with no properties at all', () => {
    const rows = buildChecksRows(paneCRow({ properties: null }), NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.local_inclusion.yours?.label).toBe('not present')
    expect(byKey.local_inclusion.yours?.detail).toBe('no checkpoint covers this record')
    expect(byKey.checkpoint_signature.yours?.label).toBe('not present')
    expect(byKey.continuity.yours?.label).toBe('not present')
  })

  it('external_registration defaults to not present, with a receipt-specific detail, not the checkpoint one', () => {
    const rows = buildChecksRows(paneCRow({ properties: null }), NOT_RECOMPUTED)
    const externalRegistration = rows.find((r) => r.key === 'external_registration')
    expect(externalRegistration?.yours?.label).toBe('not present')
    expect(externalRegistration?.yours?.detail).toBe('no receipt covers this record')
  })

  it('a property with no absence rule (task_binding) still defaults to not checked, unchanged', () => {
    const rows = buildChecksRows(paneCRow({ properties: null }), NOT_RECOMPUTED)
    const taskBinding = rows.find((r) => r.key === 'task_binding')
    expect(taskBinding?.yours?.label).toBe('not checked')
  })
})

describe('buildChecksRows — continuity established only if checkpoint_signature established', () => {
  it('downgrades a claimed continuity PASS to not present when checkpoint_signature is not established', () => {
    const row = paneCRow({
      properties: {
        checkpoint_signature: { state: 'NOT_PRESENT' },
        continuity: { state: 'PASS' }
      }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const continuity = rows.find((r) => r.key === 'continuity')
    expect(continuity?.yours?.state).toBe('NOT_PRESENT')
    expect(continuity?.yours?.label).toBe('not present')
  })

  it('leaves continuity PASS alone when checkpoint_signature is also established', () => {
    const row = paneCRow({
      properties: {
        checkpoint_signature: { state: 'PASS' },
        continuity: { state: 'PASS' }
      }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const continuity = rows.find((r) => r.key === 'continuity')
    expect(continuity?.yours?.state).toBe('PASS')
    expect(continuity?.yours?.label).toBe('established')
  })

  it('does not invent a stronger negative -- a continuity FAIL/INCONCLUSIVE from the sidecar passes through unchanged', () => {
    const row = paneCRow({
      properties: {
        checkpoint_signature: { state: 'NOT_PRESENT' },
        continuity: { state: 'FAIL', text: 'checkpoint mismatch at leaf 12' }
      }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const continuity = rows.find((r) => r.key === 'continuity')
    expect(continuity?.yours?.state).toBe('FAIL')
    expect(continuity?.yours?.detail).toBe('checkpoint mismatch at leaf 12')
  })
})

describe('buildChecksRows — capture_coverage: fixed sentence or not present, never a PASS variant', () => {
  it('renders the fixed sentence when the sidecar has a record for it', () => {
    const rows = buildChecksRows(paneCRow({ properties: { capture_coverage: { state: 'PASS' } } }), NOT_RECOMPUTED)
    const captureCoverage = rows.find((r) => r.key === 'capture_coverage')
    expect(captureCoverage?.singleLine).toBe('captured at the sidecar observe path (rule: every served exchange)')
    expect(captureCoverage?.yours).toBeNull()
    expect(captureCoverage?.theirs).toBeNull()
  })

  it('renders "not present" when the sidecar sends nothing for it', () => {
    const rows = buildChecksRows(paneCRow({ properties: null }), NOT_RECOMPUTED)
    const captureCoverage = rows.find((r) => r.key === 'capture_coverage')
    expect(captureCoverage?.singleLine).toBe('not present')
  })

  it('an explicit NOT_PRESENT state also renders "not present", not the sentence', () => {
    const rows = buildChecksRows(
      paneCRow({ properties: { capture_coverage: { state: 'NOT_PRESENT' } } }),
      NOT_RECOMPUTED
    )
    const captureCoverage = rows.find((r) => r.key === 'capture_coverage')
    expect(captureCoverage?.singleLine).toBe('not present')
  })
})

describe('buildChecksRows — identity/authority: two facts, not one state', () => {
  it('binding is "not present" and authority is always "not present" when nothing is bound', () => {
    const rows = buildChecksRows(paneCRow({ properties: null }), NOT_RECOMPUTED)
    const identityAuthority = rows.find((r) => r.key === 'identity_authority')
    expect(identityAuthority?.yours).toBeNull()
    expect(identityAuthority?.facts?.map((f) => f.factLabel)).toEqual(['binding', 'authority'])
    const binding = identityAuthority?.facts?.find((f) => f.factLabel === 'binding')
    const authority = identityAuthority?.facts?.find((f) => f.factLabel === 'authority')
    expect(binding?.cell.label).toBe('not present')
    expect(authority?.cell.label).toBe('not present')
    expect(authority?.cell.detail).toMatch(/not bound to a person/)
  })

  it('binding renders "self-asserted key, valid to <expiry>" when a key is bound', () => {
    const rows = buildChecksRows(
      paneCRow({ properties: { identity_authority: { state: 'PASS', expiry: '2026-12-01' } } }),
      NOT_RECOMPUTED
    )
    const identityAuthority = rows.find((r) => r.key === 'identity_authority')
    const binding = identityAuthority?.facts?.find((f) => f.factLabel === 'binding')
    expect(binding?.cell.label).toBe('established')
    expect(binding?.cell.detail).toBe('self-asserted key, valid to 2026-12-01')
  })

  it('binding renders "failed" when the bound key is invalid', () => {
    const rows = buildChecksRows(paneCRow({ properties: { identity_authority: { state: 'FAIL' } } }), NOT_RECOMPUTED)
    const identityAuthority = rows.find((r) => r.key === 'identity_authority')
    const binding = identityAuthority?.facts?.find((f) => f.factLabel === 'binding')
    expect(binding?.cell.label).toBe('failed')
  })

  it('authority is always not present, even when binding is established', () => {
    const rows = buildChecksRows(
      paneCRow({ properties: { identity_authority: { state: 'PASS', expiry: '2026-12-01' } } }),
      NOT_RECOMPUTED
    )
    const identityAuthority = rows.find((r) => r.key === 'identity_authority')
    const authority = identityAuthority?.facts?.find((f) => f.factLabel === 'authority')
    expect(authority?.cell.label).toBe('not present')
  })
})

describe('buildChecksRows — L-L: every check row names its inputs and policy inline', () => {
  it('no property row carries an empty detail (a bare state word is forbidden)', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    for (const r of rows) {
      if (r.key === 'capture_coverage') {
        expect(r.singleLine).toBeTruthy()
        continue
      }
      if (r.key === 'identity_authority') {
        for (const fact of r.facts ?? []) expect(fact.cell.detail).toBeTruthy()
        continue
      }
      expect(r.yours?.detail).toBeTruthy()
    }
  })

  it('a sidecar-supplied text wins over the generic default', () => {
    const row = paneCRow({
      properties: { continuity: { state: 'FAIL', text: 'checkpoint mismatch at leaf 12' } }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const continuityRow = rows.find((r) => r.key === 'continuity')
    expect(continuityRow?.yours?.detail).toBe('checkpoint mismatch at leaf 12')
  })
})

describe('buildChecksRows — L-M: recomputed-here and from-sidecar are never the same', () => {
  it('content_binding/producer_signature are flagged recomputed; the rest are not', () => {
    const rows = buildChecksRows(paneCRow(), RECOMPUTED_MATCH)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.content_binding.yours?.recomputed).toBe(true)
    expect(byKey.producer_signature.yours?.recomputed).toBe(true)
    expect(byKey.task_binding.yours?.recomputed).toBe(false)
    expect(byKey.local_inclusion.yours?.recomputed).toBe(false)
    expect(byKey.outcome_corroboration.yours?.recomputed).toBe(false)
  })

  it('recomputed properties always say "recomputed in browser", never a sidecar phrase', () => {
    const rows = buildChecksRows(paneCRow(), RECOMPUTED_MATCH)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.content_binding.yours?.detail).toBe('recomputed in browser')
    expect(byKey.producer_signature.yours?.detail).toBe('recomputed in browser')
  })

  it('content_binding reflects idMatch, never upgraded to established when unrecomputed', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    const contentBinding = rows.find((r) => r.key === 'content_binding')
    expect(contentBinding?.yours?.state).toBe('NOT_CHECKED')
    expect(contentBinding?.yours?.label).toBe('not checked')
  })
})

describe('buildChecksRows — forbidden mutant: never NOT_CHECKED together with recomputed:true', () => {
  it('content_binding/producer_signature are NOT flagged recomputed while the recompute has not run yet', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.content_binding.yours?.state).toBe('NOT_CHECKED')
    expect(byKey.content_binding.yours?.recomputed).toBe(false)
    expect(byKey.producer_signature.yours?.state).toBe('NOT_CHECKED')
    expect(byKey.producer_signature.yours?.recomputed).toBe(false)
  })

  it('says "not yet recomputed in browser", not "recomputed in browser", while unrecomputed', () => {
    const rows = buildChecksRows(paneCRow(), NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.content_binding.yours?.detail).toBe('not yet recomputed in browser')
  })

  it('no row, in any identity state, ever pairs NOT_CHECKED with recomputed:true', () => {
    for (const identity of [
      NOT_RECOMPUTED,
      RECOMPUTED_MATCH,
      { idMatch: false, signatureOk: null } as RecomputedIdentity,
      { idMatch: null, signatureOk: false } as RecomputedIdentity
    ]) {
      const rows = buildChecksRows(paneCRow(), identity)
      for (const r of rows) {
        if (r.yours) expect(r.yours.state === 'NOT_CHECKED' && r.yours.recomputed).toBe(false)
        if (r.theirs) expect(r.theirs.state === 'NOT_CHECKED' && r.theirs.recomputed).toBe(false)
      }
    }
  })
})

describe('buildChecksRows — THEIRS column (v1 §P5 / recompute-identity.ts: no full record for a counterparty half)', () => {
  it('theirs column is entirely absent when theirs.state is absent (L-G)', () => {
    const row = paneCRow({ theirs: { state: 'absent', capsule_id: null } })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    for (const r of rows) {
      if (r.key === 'capture_coverage' || r.key === 'identity_authority') continue
      expect(r.theirs).toBeNull()
    }
  })

  it('theirs is always NOT_CHECKED when held -- never a claimed PASS this page cannot back', () => {
    const rows = buildChecksRows(paneCRow(), RECOMPUTED_MATCH)
    for (const r of rows) {
      if (r.key === 'capture_coverage' || r.key === 'identity_authority') continue
      expect(r.theirs?.state).toBe('NOT_CHECKED')
      expect(r.theirs?.recomputed).toBe(false)
      expect(r.theirs?.detail).toBeTruthy()
    }
  })
})

describe('buildIdentityRow', () => {
  it('yours reflects the actual recompute result, never a hardcoded match', () => {
    const mismatch: RecomputedIdentity = { idMatch: false, signatureOk: null }
    const identityRow = buildIdentityRow(paneCRow(), mismatch)
    expect(identityRow.yours.note).toMatch(/MISMATCH/)
  })

  it('theirs is absent (null) when theirs.state is absent', () => {
    const row = paneCRow({ theirs: { state: 'absent', capsule_id: null } })
    const identityRow = buildIdentityRow(row, NOT_RECOMPUTED)
    expect(identityRow.theirs).toBeNull()
  })

  it('theirs never claims "recomputed" -- it was never recomputed', () => {
    const identityRow = buildIdentityRow(paneCRow(), RECOMPUTED_MATCH)
    expect(identityRow.theirs?.note).not.toMatch(/recomputed here, matches/)
  })
})

describe('buildHeaderRows / buildCommitsToRows — no fabricated fields', () => {
  it('degrades to an honest placeholder rather than inventing a value', () => {
    const headerRows = buildHeaderRows(paneCRow(), null)
    const keyId = headerRows.find((r) => r.label === 'key id')
    expect(keyId?.yours.value).toBe('unavailable')
  })

  it('commits-to reads real digests off the local record when present', () => {
    const rows = buildCommitsToRows(paneCRow(), {
      effect: { request_digest: 'digest-a', response_digest: 'digest-b' }
    } as never)
    const requestDigest = rows.find((r) => r.label === 'request digest')
    expect(requestDigest?.yours).toBe('digest-a')
  })
})
