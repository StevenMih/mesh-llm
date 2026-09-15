import { describe, expect, it } from 'vitest'
import {
  buildRegistrationCopy,
  buildSetupSteps,
  CAPTURE_BOUNDARY_FACT,
  CONTINUITY_NOT_ESTABLISHED,
  identityFact,
  RETENTION_FACT
} from '@/features/capsules/lib/integrity-view'

describe('buildSetupSteps — ledger-ux-from-the-user §6, three steps in value order', () => {
  it('renders all three steps "not set up" / "never asked" on a bare node', () => {
    const steps = buildSetupSteps(null, null)
    expect(steps.map((step) => step.title)).toEqual([
      'Register your checkpoints',
      'Bind an owner identity',
      'Ask a peer for their half'
    ])
    expect(steps.every((step) => !step.done)).toBe(true)
    expect(steps[0].status).toBe('not set up')
    expect(steps[1].status).toBe('not set up')
    expect(steps[2].status).toBe('never asked')
    // Each explains what it buys and what it does not.
    expect(steps[0].body).toMatch(/does not make your records true/)
    expect(steps[1].body).toMatch(/does not prove who you are/)
    expect(steps[2].body).toBe('Corroboration cannot come from you.')
  })

  it('step 1 flips to "registered" once a checkpoint exists, and drops its explanatory body', () => {
    const steps = buildSetupSteps({ checkpoint_count: 3 }, null)
    expect(steps[0].done).toBe(true)
    expect(steps[0].status).toBe('registered')
    expect(steps[0].body).toBeNull()
  })

  it('step 2 flips to "bound" once the live owner is verified', () => {
    const steps = buildSetupSteps(null, { status: 'verified', verified: true })
    expect(steps[1].done).toBe(true)
    expect(steps[1].status).toBe('bound')
    expect(steps[1].body).toBeNull()
  })

  it('step 2 stays "not set up" when the wire carries no owner at all', () => {
    const steps = buildSetupSteps(null, undefined)
    expect(steps[1].done).toBe(false)
  })

  it('step 3 flips to "asked <date>" once the card carries an ask record', () => {
    const steps = buildSetupSteps({ asked_peer_at: '2026-09-12' }, null)
    expect(steps[2].done).toBe(true)
    expect(steps[2].status).toBe('asked 2026-09-12')
    expect(steps[2].body).toBeNull()
  })
})

describe('buildRegistrationCopy — only renders once a checkpoint exists', () => {
  it('is null when no checkpoint exists', () => {
    expect(buildRegistrationCopy(null)).toBeNull()
    expect(buildRegistrationCopy({ checkpoint_count: 0 })).toBeNull()
    expect(buildRegistrationCopy({ checkpoint_count: null })).toBeNull()
  })

  it('renders "Registered with N witnesses (M not operated by this node)"', () => {
    const copy = buildRegistrationCopy({
      checkpoint_count: 2,
      witnesses: [{ operated_by_producer: true }, { operated_by_producer: false }, {}]
    })
    expect(copy).not.toBeNull()
    expect(copy?.witnessSummary).toBe('Registered with 3 witnesses (2 not operated by this node)')
  })

  it('a witness with no operated_by_producer field counts toward M (errs independent-claim-is-wrong)', () => {
    const copy = buildRegistrationCopy({ checkpoint_count: 1, witnesses: [{}] })
    expect(copy?.witnessSummary).toBe('Registered with 1 witness (1 not operated by this node)')
  })

  it('adds "registered no later than T" only when the card carries it', () => {
    const withDate = buildRegistrationCopy({
      checkpoint_count: 1,
      witnesses: [],
      registered_no_later_than: '2026-09-10T00:00:00Z'
    })
    expect(withDate?.registeredNoLaterThan).toBe('registered no later than 2026-09-10T00:00:00Z')

    const withoutDate = buildRegistrationCopy({ checkpoint_count: 1, witnesses: [] })
    expect(withoutDate?.registeredNoLaterThan).toBeNull()
  })
})

describe('once-per-node facts — never fabricated, never per-row', () => {
  it('retention and capture-boundary are stated facts, not data claims', () => {
    expect(RETENTION_FACT).toMatch(/Retention:/)
    expect(CAPTURE_BOUNDARY_FACT).toMatch(/Capture boundary:/)
  })

  it('identity fact renders bound vs. not-bound, always ending "not bound to a person"', () => {
    expect(identityFact(null)).toBe('Owner: not bound — not bound to a person.')
    expect(identityFact({ status: 'verified', verified: true })).toBe(
      'Owner: bound (self-asserted) — not bound to a person.'
    )
  })

  it('continuity default prose names what would establish it', () => {
    expect(CONTINUITY_NOT_ESTABLISHED).toBe(
      'Continuity: not established. It needs a registered checkpoint and a prior one to bind to.'
    )
  })
})

describe('banned vocabulary — never "timestamped", never bare "witnessed"', () => {
  const allStrings = [
    RETENTION_FACT,
    CAPTURE_BOUNDARY_FACT,
    CONTINUITY_NOT_ESTABLISHED,
    identityFact(null),
    identityFact({ status: 'verified', verified: true }),
    ...buildSetupSteps(null, null).flatMap((step) => [step.title, step.status, step.body ?? '']),
    ...buildSetupSteps({ checkpoint_count: 1 }, { verified: true }).flatMap((step) => [
      step.title,
      step.status,
      step.body ?? ''
    ]),
    buildRegistrationCopy({ checkpoint_count: 1, witnesses: [{}] })?.witnessSummary ?? ''
  ]

  it('never renders "timestamped"', () => {
    for (const text of allStrings) expect(text.toLowerCase()).not.toMatch(/timestamped/)
  })

  it('never renders bare "witnessed" (registration copy says "witnesses", not "witnessed")', () => {
    for (const text of allStrings) expect(text.toLowerCase()).not.toMatch(/\bwitnessed\b/)
  })
})
