import { describe, expect, it } from 'vitest'
import {
  buildRegistrationCopy,
  buildSetupSteps,
  CAPTURE_BOUNDARY_FACT,
  chainStripCaption,
  CHECKPOINTED_NOT_REGISTERED_STATUS,
  checkpointRegistration,
  CONTINUITY_NOT_ESTABLISHED,
  identityFact,
  RETENTION_FACT
} from '@/features/capsules/lib/integrity-view'

describe('buildSetupSteps — ledger-ux-from-the-user §6, three steps in value order', () => {
  it('renders all three steps "not set up" / "none received yet" on a bare node (checkpoint_count REPORTED 0)', () => {
    // A bare node's host reports `checkpoint_count: 0` (capsule_panes_native's
    // build_pane_a always supplies the card) -- genuinely none yet, "not set up".
    const steps = buildSetupSteps({ checkpoint_count: 0 }, null)
    expect(steps.map((step) => step.title)).toEqual([
      'Register your checkpoints',
      'Bind an owner identity',
      'Get the other side’s half'
    ])
    expect(steps.every((step) => !step.done)).toBe(true)
    expect(steps[0].status).toBe('not set up')
    expect(steps[1].status).toBe('not set up')
    expect(steps[2].status).toBe('none received yet')
    // Each explains what it buys and what it does not.
    expect(steps[0].body).toMatch(/does not make your records true/)
    expect(steps[1].body).toMatch(/does not prove who you are/)
    expect(steps[2].body).toMatch(/Corroboration cannot come from you/)
    // The retired "never asked" framing is gone -- a half can arrive by push.
    expect(steps[2].status).not.toMatch(/never asked/)
  })

  it('step 3 reflects the push-confirmed reality: a nonzero closed-by-other-side count marks it done, worded like the tile', () => {
    // [mesh-closed-on-frozen-base] The rung must not read "never asked" while
    // the tile reads CLOSED-BY-OTHER-SIDE N -- halves arrived by push.
    const steps = buildSetupSteps({ checkpoint_count: 0 }, null, 3)
    expect(steps[2].done).toBe(true)
    expect(steps[2].status).toBe('3 confirmed by the other side')
    expect(steps[2].body).toBeNull()
  })

  it('checkpoints step reads a NULL card as "status not reported", NOT a false "not set up"', () => {
    // The costliest false absence: a null card means the host did not REPORT a
    // checkpoint count -- it must never render as "none exists". Four states,
    // never two: null -> not reported; 0 -> not set up; >0 unwitnessed ->
    // checkpointed locally; witnessed -> registered.
    const notReported = buildSetupSteps(null, null)
    expect(notReported[0].status).toBe('status not reported')
    expect(notReported[0].done).toBe(false)
    expect(notReported[0].body).toMatch(/did not report its checkpoint status/)
    expect(notReported[0].body).not.toMatch(/does not make your records true/)

    const genuinelyNone = buildSetupSteps({ checkpoint_count: 0 }, null)
    expect(genuinelyNone[0].status).toBe('not set up')

    const checkpointedOnly = buildSetupSteps({ checkpoint_count: 2 }, null)
    expect(checkpointedOnly[0].status).toBe(CHECKPOINTED_NOT_REGISTERED_STATUS)
  })

  it('[mesh-citing-record-shots-four-defects] D1: a local checkpoint with ZERO witnesses NEVER reads "registered" — the exact §7 overclaim', () => {
    // The live shot: rung 1 said "registered" while the same pane said
    // "Registered with 0 witnesses" and Exchanges said "not registered".
    // Local checkpointing is NOT registration.
    const steps = buildSetupSteps({ checkpoint_count: 3, witnesses: [] }, null)
    expect(steps[0].done).toBe(false)
    expect(steps[0].status).toBe('checkpointed locally · not registered (witness: off)')
    expect(steps[0].status).not.toBe('registered')
    // The step still explains what registration would buy -- the reader is
    // exactly the person deciding whether to do it.
    expect(steps[0].body).toMatch(/does not make your records true/)
  })

  it('step 1 flips to "registered" ONLY once a witness actually holds a checkpoint, and drops its explanatory body', () => {
    const steps = buildSetupSteps({ checkpoint_count: 3, witnesses: [{}] }, null)
    expect(steps[0].done).toBe(true)
    expect(steps[0].status).toBe('registered')
    expect(steps[0].body).toBeNull()
  })

  it('rung 1, the witness line, and the Exchanges headline fact all derive from the ONE checkpointRegistration fact', () => {
    // Three surfaces, one derivation -- they can never disagree again.
    const unwitnessed = { checkpoint_count: 5, witnesses: [] }
    const registration = checkpointRegistration(unwitnessed)
    expect(registration.registered).toBe(false)
    expect(registration.checkpointedLocally).toBe(true)
    expect(buildSetupSteps(unwitnessed, null)[0].status).toContain('not registered')
    expect(buildRegistrationCopy(unwitnessed)?.witnessSummary).toContain('not registered')

    const witnessed = { checkpoint_count: 5, witnesses: [{}] }
    expect(checkpointRegistration(witnessed).registered).toBe(true)
    expect(buildSetupSteps(witnessed, null)[0].status).toBe('registered')
    expect(buildRegistrationCopy(witnessed)?.witnessSummary).toMatch(/^Registered with 1 witness/)
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

  it('[mesh-citing-record-shots-four-defects] D1: an unwitnessed checkpoint reads "checkpointed locally", NEVER "Registered with 0 witnesses"', () => {
    const copy = buildRegistrationCopy({ checkpoint_count: 2, witnesses: [] })
    expect(copy?.witnessSummary).toBe('Checkpointed locally · not registered (witness: off)')
    expect(copy?.witnessSummary).not.toMatch(/Registered with 0/)
  })

  it('adds "registered no later than T" only when a witness holds the checkpoint; unwitnessed says "checkpointed no later than"', () => {
    const registered = buildRegistrationCopy({
      checkpoint_count: 1,
      witnesses: [{}],
      registered_no_later_than: '2026-09-10T00:00:00Z'
    })
    expect(registered?.registeredNoLaterThan).toBe('registered no later than 2026-09-10T00:00:00Z')

    // The card field name is the wire's; the COPY must not overclaim -- an
    // unwitnessed checkpoint's timestamp is a local fact, not a registration.
    const unwitnessed = buildRegistrationCopy({
      checkpoint_count: 1,
      witnesses: [],
      registered_no_later_than: '2026-09-10T00:00:00Z'
    })
    expect(unwitnessed?.registeredNoLaterThan).toBe('checkpointed no later than 2026-09-10T00:00:00Z')

    const withoutDate = buildRegistrationCopy({ checkpoint_count: 1, witnesses: [] })
    expect(withoutDate?.registeredNoLaterThan).toBeNull()
  })
})

describe('chainStripCaption — leaf pluralization + the three absence states', () => {
  it('pluralizes correctly off the COVERED-LEAF count: "1 leaf", never "1 leaves"', () => {
    // 3rd arg is the covered-leaf count; 2nd is the checkpoint-LINE count.
    expect(chainStripCaption(5, 1, 1)).toBe('covered by checkpoint (1 leaf) · after the last checkpoint is unshaded')
    expect(chainStripCaption(5, 1, 3)).toBe('covered by checkpoint (3 leaves) · after the last checkpoint is unshaded')
  })

  it('renders the covered-leaf count, NOT the checkpoint-line count', () => {
    // The bug: a SINGLE checkpoint line covering 8 leaves read "1 leaves"
    // because the caption printed checkpoint_count. It must print the covered
    // leaf count (8), against the live-ledger reshoot: mmr_size 15 -> 8 leaves.
    expect(chainStripCaption(8, 1, 8)).toBe(
      'covered by checkpoint (8 leaves) · after the last checkpoint is unshaded'
    )
  })

  it('says so honestly when a checkpoint exists but no covered-leaf count was reported', () => {
    // Never reprint the checkpoint-line count as if it were a leaf count.
    expect(chainStripCaption(5, 2, null)).toBe(
      'covered by checkpoint (covered leaf count not reported) · after the last checkpoint is unshaded'
    )
  })

  it('keeps the three-state absence handling: null card is "not reported", never a false "no checkpoint yet"', () => {
    expect(chainStripCaption(2, null, null)).toBe('2 entries, all sealed · checkpoint status not reported')
    expect(chainStripCaption(1, 0, null)).toBe('1 entry, all sealed · no checkpoint yet · nothing here is registered')
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
