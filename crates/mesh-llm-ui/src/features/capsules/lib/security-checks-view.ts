// Toggle ② the security view ([mesh-ledger-b5-security-view], v3 §4) -- pure
// view-model derivation, kept separate from `SecurityChecksView.tsx`'s
// rendering so the honesty rules below are unit-testable without mounting a
// component. Exact block order: IDENTITY -> HEADER -> WHAT IT COMMITS TO ->
// CHECKS -> raw.
//
// The mockup in v3 §4 draws a fully two-sided CHECKS table (a YOURS and a
// THEIRS column, both populated). The real wire contract doesn't back that:
// `PaneCRow.theirs` carries only `{state, capsule_id, ...}` -- no bytes, no
// signature, no per-property checks -- and `useRecomputedIdentity`'s own
// contract is explicit that a counterparty's half in Pane C has no full
// record to recompute against (`recompute-identity.ts`). So THEIRS never
// renders a state this page didn't actually check: every THEIRS cell is
// `NOT_CHECKED` with an honest reason, or the whole column is absent when
// `theirs.state === 'absent'` (L-G, the same rule the row's own "WHAT IT
// COMMITS TO" comparison already lives by).
import type { CapsuleRecord } from '@/features/capsules/api/types'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { RecomputedIdentity } from '@/features/capsules/lib/recompute-identity'
import { NINE_PROPERTY_LABELS, PROPERTY_GROUP, RECOMPUTED_PROPERTIES } from '@/features/capsules/lib/nine-properties'
import { labelForState } from '@/features/capsules/lib/assurance-tone'

function boolToWireState(value: boolean | null): string {
  return value === null ? 'NOT_CHECKED' : value ? 'PASS' : 'FAIL'
}

function theirsHeld(row: PaneCRow): boolean {
  return row.theirs.state !== 'absent'
}

// ---------------------------------------------------------------------------
// IDENTITY
// ---------------------------------------------------------------------------

export type IdentityCell = { value: string; note: string }
export type IdentityRow = { label: string; yours: IdentityCell; theirs: IdentityCell | null }

export function buildIdentityRow(row: PaneCRow, identity: RecomputedIdentity): IdentityRow {
  const yoursNote =
    identity.idMatch === true
      ? '✓ recomputed here, matches'
      : identity.idMatch === false
        ? '✕ recomputed here, MISMATCH'
        : 'not yet recomputed'
  return {
    label: 'capsule id',
    yours: { value: row.mine.capsule_id ?? '—', note: yoursNote },
    theirs: theirsHeld(row) ? { value: row.theirs.capsule_id ?? '—', note: 'as given, not recomputed' } : null
  }
}

// ---------------------------------------------------------------------------
// HEADER -- trimmed to fields this page actually has: a per-record wire
// timestamp, this system's one fixed signing algorithm (EdDSA/Ed25519, the
// only one `cose.ts` ever verifies against -- a true system-wide constant,
// not a per-record invention), the local record's own `key_id` (a real top-
// level field -- see `canonical.ts`'s exclusion list), and the exchange id
// itself. Fields the wire contract doesn't carry at all today (content type,
// capture boundary/rule as distinct fields, a client nonce) are left out
// rather than rendered as a permanently-"unavailable" row for a concept that
// doesn't exist in this data yet -- capture boundary/rule is covered by the
// CHECKS block's own `capture_coverage` line instead of being duplicated
// here.
// ---------------------------------------------------------------------------

export type HeaderCell = { value: string; note?: string }
export type HeaderRow = { label: string; yours: HeaderCell; theirs: HeaderCell | null }

export function buildHeaderRows(row: PaneCRow, localRecord: CapsuleRecord | null): HeaderRow[] {
  const held = theirsHeld(row)
  const keyId = localRecord && typeof localRecord.key_id === 'string' ? (localRecord.key_id as string) : null
  return [
    {
      label: 'sealed at',
      yours: { value: row.timestamp ?? 'timestamp unavailable' },
      theirs: held ? { value: 'not available' } : null
    },
    {
      label: 'algorithm',
      yours: { value: 'EdDSA / Ed25519' },
      theirs: held ? { value: 'EdDSA / Ed25519' } : null
    },
    {
      label: 'key id',
      yours: { value: keyId ?? 'unavailable' },
      theirs: held ? { value: 'unavailable' } : null
    },
    {
      label: 'exchange id',
      yours: { value: row.exchange_key },
      theirs: held ? { value: row.exchange_key, note: '✓ same' } : null
    }
  ]
}

// ---------------------------------------------------------------------------
// WHAT IT COMMITS TO -- the digest-shaped facts a record actually names.
// Theirs is always absent here (L-G): even on a closed row, this page holds
// no independent copy of their digests, only their citation of ours (which
// the row's own right-cell state already says in words).
// ---------------------------------------------------------------------------

export type CommitsToRow = { label: string; yours: string }

export function buildCommitsToRows(row: PaneCRow, localRecord: CapsuleRecord | null): CommitsToRow[] {
  const effect = (localRecord?.effect ?? null) as { request_digest?: string; response_digest?: string } | null
  const taskBindingCell = row.properties?.task_binding ?? null
  const modelId = localRecord?.model_attestation?.model_id ?? null
  return [
    { label: 'request digest', yours: effect?.request_digest ?? 'unavailable' },
    { label: 'response digest', yours: effect?.response_digest ?? 'unavailable' },
    { label: 'task binding', yours: taskBindingCell?.text ?? 'from the record' },
    { label: 'model identity', yours: modelId ?? 'unavailable' },
    { label: 'served by', yours: row.role_tag === 'SERVED' ? 'this node' : 'counterparty' }
  ]
}

// ---------------------------------------------------------------------------
// CHECKS -- the ten manifesto properties (capture_coverage renders as one
// full-width line, no YOURS/THEIRS split, matching v3 §4's mockup).
//
// [ledger-T3-vocabulary-and-states] Q1/L-L/L-M/L-G still hold (see below),
// plus this task's own rules:
//  - `local_inclusion`/`checkpoint_signature`/`continuity` and
//    `external_registration` resolve NOT_PRESENT, never the generic
//    NOT_CHECKED default, when the sidecar sends nothing for them --
//    "no checkpoint/receipt covers this record" is a fact, not an
//    unchecked question.
//  - `continuity` is established ONLY if `checkpoint_signature` is
//    established -- a sidecar-asserted continuity PASS is downgraded to
//    NOT_PRESENT if its own dependency isn't established (a checkpoint
//    signature this page cannot see cannot anchor continuity).
//  - `capture_coverage` renders the fixed sentence when the sidecar has a
//    record for it, else the bare `not present` result -- never a PASS
//    chip/variant.
//  - `identity_authority` is two fixed facts, not one state: binding
//    (absent/bound/invalid) and authority (ALWAYS not present -- this
//    system never binds a person). See `buildIdentityAuthorityFacts`.
//  - a property is never rendered `NOT_CHECKED` while flagged `recomputed`
//    -- that combination asserts "recomputed in-browser" and "we didn't
//    check" at once, which is a contradiction (the forbidden mutant).
// ---------------------------------------------------------------------------

export type ChecksSideCell = {
  /** Wire state (`PASS`/`FAIL`/...). */
  state: string
  /** Lowercase manifesto word (Q1) -- `established`/`failed`/... */
  label: string
  /** L-L: the input/policy phrase that must render beside the state,
   *  always -- never a bare state word. */
  detail: string
  /** L-M: true only when this cell's value actually came from an
   *  in-browser recompute that ran (never true merely because the key is
   *  one of `RECOMPUTED_PROPERTIES` -- see the forbidden-mutant note
   *  above). Drives the visual distinction from sidecar-sourced
   *  properties. */
  recomputed: boolean
}

/** One named fact under the `identity_authority` row -- `binding` or
 *  `authority`. Kept as facts under ONE row (not two rows) so the row's
 *  key stays `identity_authority` and the manifesto's ten-key list is
 *  unchanged. */
export type IdentityAuthorityFact = { factLabel: string; cell: ChecksSideCell }

export type ChecksRow = {
  key: string
  label: string
  /** Which of the two labelled groups this row belongs to
   *  (`nine-properties.ts`'s `PROPERTY_GROUP`). */
  group: string
  yours: ChecksSideCell | null
  theirs: ChecksSideCell | null
  /** `capture_coverage` only -- one line, no column split. */
  singleLine?: string
  /** `identity_authority` only -- two facts, no YOURS/THEIRS split. */
  facts?: IdentityAuthorityFact[]
}

// Properties whose absence means "no checkpoint covers this record" --
// distinct wording from `external_registration`'s "no receipt".
const CHECKPOINT_DEPENDENT = new Set(['local_inclusion', 'checkpoint_signature', 'continuity'])

function yoursDetailFor(key: string, state: string, text: string | undefined, actuallyRecomputed: boolean): string {
  if (text) return text
  if (actuallyRecomputed) return 'recomputed in browser'
  if (RECOMPUTED_PROPERTIES.has(key)) return 'not yet recomputed in browser'
  if (state === 'NOT_PRESENT') {
    // [ledger-T6-integrity-completion]: once-per-node checkpoint/registration
    // facts live on the Integrity section, never repeated per row -- this
    // row links back with one line instead of duplicating them.
    if (key === 'local_inclusion') return 'Range facts: no checkpoint covers this record — see Integrity.'
    if (CHECKPOINT_DEPENDENT.has(key)) return 'no checkpoint covers this record'
    if (key === 'external_registration') return 'no receipt covers this record'
  }
  return 'from the record'
}

function theirsDetailFor(key: string): string {
  return RECOMPUTED_PROPERTIES.has(key) ? 'their bytes not held' : 'their log, no proof given'
}

function absentDefaultFor(key: string): string {
  return CHECKPOINT_DEPENDENT.has(key) || key === 'external_registration' ? 'NOT_PRESENT' : 'NOT_CHECKED'
}

function buildIdentityAuthorityFacts(row: PaneCRow): IdentityAuthorityFact[] {
  const cell = row.properties?.identity_authority ?? null
  const bindingState = cell?.state ?? 'NOT_PRESENT'

  let binding: ChecksSideCell
  if (bindingState === 'PASS') {
    const expiry = typeof cell?.expiry === 'string' ? cell.expiry : 'unknown'
    binding = {
      state: 'PASS',
      label: labelForState('PASS'),
      detail: typeof cell?.text === 'string' ? cell.text : `self-asserted key, valid to ${expiry}`,
      recomputed: false
    }
  } else if (bindingState === 'FAIL') {
    binding = {
      state: 'FAIL',
      label: labelForState('FAIL'),
      detail: typeof cell?.text === 'string' ? cell.text : 'signature invalid',
      recomputed: false
    }
  } else {
    binding = {
      state: 'NOT_PRESENT',
      label: labelForState('NOT_PRESENT'),
      detail: 'no key bound',
      recomputed: false
    }
  }

  // Authority (a person standing behind the key) is always `not present` --
  // this system never binds a person to a key. Not a fact about this
  // record; a fact about the system.
  const owner = typeof cell?.owner === 'string' ? cell.owner : '…'
  const authority: ChecksSideCell = {
    state: 'NOT_PRESENT',
    label: labelForState('NOT_PRESENT'),
    detail: `Owner: ${owner} — not bound to a person.`,
    recomputed: false
  }

  return [
    { factLabel: 'binding', cell: binding },
    { factLabel: 'authority', cell: authority }
  ]
}

export function buildChecksRows(row: PaneCRow, identity: RecomputedIdentity): ChecksRow[] {
  const held = theirsHeld(row)
  const checkpointSignatureState = row.properties?.checkpoint_signature?.state ?? 'NOT_PRESENT'

  return Object.keys(NINE_PROPERTY_LABELS).map((key) => {
    const label = NINE_PROPERTY_LABELS[key]
    const group = PROPERTY_GROUP[key]

    if (key === 'capture_coverage') {
      const cell = row.properties?.[key] ?? null
      const singleLine =
        cell && cell.state !== 'NOT_PRESENT'
          ? (cell.text ?? 'captured at the sidecar observe path (rule: every served exchange)')
          : labelForState('NOT_PRESENT')
      return { key, label, group, yours: null, theirs: null, singleLine }
    }

    if (key === 'identity_authority') {
      return { key, label, group, yours: null, theirs: null, facts: buildIdentityAuthorityFacts(row) }
    }

    const recomputable = RECOMPUTED_PROPERTIES.has(key)
    let yoursState: string
    if (recomputable) {
      yoursState = boolToWireState(key === 'content_binding' ? identity.idMatch : identity.signatureOk)
    } else {
      yoursState = row.properties?.[key]?.state ?? absentDefaultFor(key)
      // Continuity is established ONLY if checkpoint_signature is: a
      // sidecar-claimed continuity PASS with no established checkpoint
      // signature to anchor to is downgraded. A continuity state that
      // was already something other than PASS (FAIL/INCONCLUSIVE/
      // NOT_CHECKED) is left as-is -- this rule only blocks the upgrade
      // to "established," it doesn't invent a stronger negative result.
      if (key === 'continuity' && yoursState === 'PASS' && checkpointSignatureState !== 'PASS') {
        yoursState = 'NOT_PRESENT'
      }
    }
    const yoursText = recomputable ? undefined : (row.properties?.[key]?.text as string | undefined)
    // The forbidden mutant: a property is only "recomputed" if the
    // recompute actually produced a value -- not merely because its key
    // is recomputable while the recompute hasn't run yet (idMatch/
    // signatureOk still null, so yoursState is NOT_CHECKED).
    const actuallyRecomputed = recomputable && yoursState !== 'NOT_CHECKED'

    const yours: ChecksSideCell = {
      state: yoursState,
      label: labelForState(yoursState),
      detail: yoursDetailFor(key, yoursState, yoursText, actuallyRecomputed),
      recomputed: actuallyRecomputed
    }

    const theirs: ChecksSideCell | null = held
      ? {
          state: 'NOT_CHECKED',
          label: labelForState('NOT_CHECKED'),
          detail: theirsDetailFor(key),
          recomputed: false
        }
      : null

    return { key, label, group, yours, theirs }
  })
}
