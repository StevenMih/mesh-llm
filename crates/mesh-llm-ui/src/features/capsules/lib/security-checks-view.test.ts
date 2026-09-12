import { describe, expect, it } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { NINE_PROPERTY_LABELS } from '@/features/capsules/lib/nine-properties'
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
})

describe('buildChecksRows — Q1: five results render lowercase, never shouty caps', () => {
  it('established/failed/not present/not checked/inconclusive, not PASS/FAIL/...', () => {
    const row = paneCRow({
      properties: {
        task_binding: { state: 'PASS' },
        local_inclusion: { state: 'FAIL' },
        checkpoint_signature: { state: 'NOT_PRESENT' },
        external_registration: { state: 'NOT_CHECKED' },
        continuity: { state: 'INCONCLUSIVE' }
      }
    })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(byKey.task_binding.yours?.label).toBe('established')
    expect(byKey.local_inclusion.yours?.label).toBe('failed')
    expect(byKey.checkpoint_signature.yours?.label).toBe('not present')
    expect(byKey.external_registration.yours?.label).toBe('not checked')
    expect(byKey.continuity.yours?.label).toBe('inconclusive')
    for (const r of rows) {
      if (r.yours) expect(r.yours.label).not.toMatch(/[A-Z]/)
    }
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
    expect(byKey.identity_authority.yours?.recomputed).toBe(false)
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

describe('buildChecksRows — THEIRS column (v1 §P5 / recompute-identity.ts: no full record for a counterparty half)', () => {
  it('theirs column is entirely absent when theirs.state is absent (L-G)', () => {
    const row = paneCRow({ theirs: { state: 'absent', capsule_id: null } })
    const rows = buildChecksRows(row, NOT_RECOMPUTED)
    for (const r of rows) {
      if (r.key === 'capture_coverage') continue
      expect(r.theirs).toBeNull()
    }
  })

  it('theirs is always NOT_CHECKED when held -- never a claimed PASS this page cannot back', () => {
    const rows = buildChecksRows(paneCRow(), RECOMPUTED_MATCH)
    for (const r of rows) {
      if (r.key === 'capture_coverage') continue
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
