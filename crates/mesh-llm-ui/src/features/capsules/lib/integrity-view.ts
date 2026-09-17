// Integrity section view-model ([ledger-T6-integrity-completion]) --
// completes the section past the chain strip + four stat cards
// ([mesh-ledger-b1-integrity-chain-strip]): the setup checklist, the
// registration copy, and the once-per-node facts. Pure functions, kept
// separate from `LedgerPage.tsx`'s rendering for the same reason
// `security-checks-view.ts` is -- testable without mounting a component.
//
// `checkpoint_count` / `continuity` / `witnesses` / `owner_added_at` /
// `owner_card_index` are the pre-existing aspirational `card` fields
// (`capsule_panes_native.rs::build_pane_a` returns `card: null` today --
// see that file's module docs on what this native reader does and does not
// compute yet). `registered_no_later_than` and `asked_peer_at` below are
// new fields in the SAME discipline: read if a future backend populates
// them, degrade to the honest "not set up" state otherwise, never
// fabricated. Owner identity is NOT read from `card` -- it comes from the
// live `/api/status` `owner` field (`StatusPayload.owner`, `lib/api/
// types.ts` -- the loose wire shape `PeerInfo['owner']` already carries,
// same field `status-adapter.ts`'s `resolveOwner` reads for the Network
// dashboard), so that one fact is real today, not aspirational.
import type { JsonRecord } from '@/features/capsules/api/types'

/** `StatusPayload.owner` / `PeerInfo['owner']` verbatim (`lib/api/
 *  types.ts`) -- deliberately not re-typed narrower than the wire shape. */
export type StatusOwner = string | { status?: string; verified?: boolean; name?: string; display_name?: string }

function ownerBound(owner: StatusOwner | null | undefined): boolean {
  if (owner == null) return false
  if (typeof owner === 'string') return owner.length > 0
  return owner.verified === true || Boolean(owner.status || owner.name || owner.display_name)
}

// ---------------------------------------------------------------------------
// Setup checklist (ledger-ux-from-the-user-2026-09-09 §6) -- three steps in
// value order, each stating what it buys and what it does not. Never a
// muted "getting started" tip -- this IS the honest state of a node with
// nothing registered, and per the design note's whole point, it should
// still be legible once each step is done.
// ---------------------------------------------------------------------------

export type SetupStep = {
  key: 'checkpoints' | 'identity' | 'ask_peer'
  title: string
  done: boolean
  /** Status word shown next to the title -- "not set up" / "registered" /
   *  "never asked" / "asked <date>". */
  status: string
  /** What it buys and what it does not -- omitted once done, since the
   *  explanatory sentence is written for someone deciding whether to do
   *  the step, not for someone who already has. */
  body: string | null
}

export function buildSetupSteps(
  card: JsonRecord | null | undefined,
  owner: StatusOwner | null | undefined
): SetupStep[] {
  const checkpointCount = typeof card?.checkpoint_count === 'number' ? card.checkpoint_count : null
  const registered = checkpointCount !== null && checkpointCount > 0
  const bound = ownerBound(owner)
  const askedPeerAt = typeof card?.asked_peer_at === 'string' ? card.asked_peer_at : null

  return [
    {
      key: 'checkpoints',
      title: 'Register your checkpoints',
      done: registered,
      status: registered ? 'registered' : 'not set up',
      body: registered
        ? null
        : 'Right now your records are checkable only against themselves. Registering a checkpoint with a service you don’t run is what makes a later rewrite detectable by someone else. It does not make your records true.'
    },
    {
      key: 'identity',
      title: 'Bind an owner identity',
      done: bound,
      status: bound ? 'bound' : 'not set up',
      body: bound
        ? null
        : '`mesh-llm auth init` binds your records to a key you hold, so a later denial is harder. It is self-asserted: it does not prove who you are.'
    },
    {
      key: 'ask_peer',
      title: 'Ask a peer for their half',
      done: askedPeerAt !== null,
      status: askedPeerAt !== null ? `asked ${askedPeerAt}` : 'never asked',
      body: askedPeerAt !== null ? null : 'Corroboration cannot come from you.'
    }
  ]
}

// ---------------------------------------------------------------------------
// Registration copy -- only renders once a checkpoint exists (v2 §4:
// "registered at N witnesses (M not operated by the producer)").
// ---------------------------------------------------------------------------

export type RegistrationCopy = {
  witnessSummary: string
  registeredNoLaterThan: string | null
}

/** `M not operated by this node` -- a witness counts toward M unless it
 *  explicitly says otherwise (`operated_by_producer: true`). Absent
 *  witness data errs toward the more independent-sounding claim being
 *  wrong, not toward silently inflating independence. */
function nonProducerWitnessCount(witnesses: readonly unknown[]): number {
  return witnesses.filter((witness) => {
    const record = witness as { operated_by_producer?: unknown } | null
    return !(record && typeof record === 'object' && record.operated_by_producer === true)
  }).length
}

export function buildRegistrationCopy(card: JsonRecord | null | undefined): RegistrationCopy | null {
  const checkpointCount = typeof card?.checkpoint_count === 'number' ? card.checkpoint_count : null
  if (checkpointCount === null || checkpointCount <= 0) return null

  const witnesses: unknown[] = Array.isArray(card?.witnesses) ? (card.witnesses as unknown[]) : []
  const nonProducerCount = nonProducerWitnessCount(witnesses)
  const registeredNoLaterThan =
    typeof card?.registered_no_later_than === 'string' ? card.registered_no_later_than : null

  return {
    witnessSummary: `Registered with ${witnesses.length} witness${witnesses.length === 1 ? '' : 'es'} (${nonProducerCount} not operated by this node)`,
    registeredNoLaterThan: registeredNoLaterThan ? `registered no later than ${registeredNoLaterThan}` : null
  }
}

// ---------------------------------------------------------------------------
// Once-per-node facts -- retention, capture boundary + rule, identity.
// Never repeated per exchange row (rows link back instead --
// `security-checks-view.ts`'s `local_inclusion` NOT_PRESENT detail).
// ---------------------------------------------------------------------------

/** Retention has no per-node "declared vs. code vs. running image"
 *  comparison wired anywhere in this codebase yet (checked: the config
 *  schema carries a declared `logging.retention_ttl_secs` /
 *  `retention_max_rows`, reachable only through the Settings state hook;
 *  no compiled-default or measured-behaviour source exists to compare it
 *  against). Points at the real setting rather than fabricating a
 *  three-way comparison this build cannot back. */
export const RETENTION_FACT =
  'Retention: set by Settings → Logging (retention length and row cap). This node does not yet compare that declared setting against a running measurement.'

/** Grounded in the real capture point (`security-checks-view.ts`'s
 *  existing per-record default, `'captured at the sidecar observe
 *  path'`) -- stated once here instead of repeated on every row. */
export const CAPTURE_BOUNDARY_FACT =
  'Capture boundary: the sidecar observe path. Rule: whatever passes through that path is what gets sealed; nothing upstream or downstream of it is captured.'

export function identityFact(owner: StatusOwner | null | undefined): string {
  if (ownerBound(owner)) {
    return 'Owner: bound (self-asserted) — not bound to a person.'
  }
  return 'Owner: not bound — not bound to a person.'
}

export const CONTINUITY_NOT_ESTABLISHED =
  'Continuity: not established. It needs a registered checkpoint and a prior one to bind to.'
