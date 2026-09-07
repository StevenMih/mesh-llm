// [mesh-pane-a-self-accountability-tab] Pane A colour discipline: green only
// on an affirmative checked-good state, grey for honestly absent/pending,
// red only for a specific named failure -- never yellow, never blended.
import { describe, expect, it } from 'vitest'
import { adjudicationsTone, historyTone, sealingTone } from '@/features/capsules/lib/self-accountability-tone'
import type { SelfAccountabilityCard } from '@/features/capsules/api/types'

function sealing(overrides: Partial<SelfAccountabilityCard['sealing']> = {}): SelfAccountabilityCard['sealing'] {
  return {
    source: 'native_log_join',
    capture_method: 'request_capsule_join',
    coverage_summary: 'coverage: fully sealed',
    unsealed_count: 0,
    last_sealed: null,
    failed_sealed: false,
    unsealed_rows: [],
    ...overrides
  }
}

function history(overrides: Partial<SelfAccountabilityCard['history']> = {}): SelfAccountabilityCard['history'] {
  return {
    source: 'history_card',
    capture_method: 'checkpoint_chain_walk',
    continuous_since: null,
    checkpoint_count: 3,
    continuity: 'unbroken',
    unforked: true,
    witnessed: true,
    witnesses: ['https://fake-ts.example'],
    cadence: {},
    ...overrides
  }
}

function adjudications(
  overrides: Partial<SelfAccountabilityCard['adjudications']> = {}
): SelfAccountabilityCard['adjudications'] {
  return {
    source: 'twin_adjudicator',
    capture_method: 'adjudication_capsule_scan',
    corroborated: 0,
    contradicted: 0,
    inconclusive: 0,
    ...overrides
  }
}

describe('sealingTone', () => {
  it('is green when fully sealed', () => {
    expect(sealingTone(sealing())).toBe('green')
  })

  // MUTANT: an unsealed request must flip the row red, never green/grey.
  it('is red when any request is unsealed', () => {
    expect(sealingTone(sealing({ unsealed_count: 1 }))).toBe('red')
  })
})

describe('historyTone', () => {
  it('is grey on an honestly-empty history', () => {
    expect(historyTone(history({ checkpoint_count: 0 }))).toBe('grey')
  })

  // MUTANT: a fork/break must flip the row red even if it happens to be witnessed.
  it('is red on a broken or forked chain', () => {
    expect(historyTone(history({ unforked: false, continuity: 'broken at mmr_size=4: ...' }))).toBe('red')
  })

  it('is grey (not green) when unbroken but not yet witnessed', () => {
    expect(historyTone(history({ witnessed: false }))).toBe('grey')
  })

  it('is green only when unbroken AND witnessed', () => {
    expect(historyTone(history({ witnessed: true }))).toBe('green')
  })
})

describe('adjudicationsTone', () => {
  it('is grey with no adjudications yet', () => {
    expect(adjudicationsTone(adjudications())).toBe('grey')
  })

  // MUTANT: even one contradiction must flip the row red, regardless of
  // how many corroborations also exist.
  it('is red when any adjudication is contradicted, even alongside corroborations', () => {
    expect(adjudicationsTone(adjudications({ corroborated: 41, contradicted: 1 }))).toBe('red')
  })

  it('is green with corroborations and zero contradictions', () => {
    expect(adjudicationsTone(adjudications({ corroborated: 1 }))).toBe('green')
  })
})
