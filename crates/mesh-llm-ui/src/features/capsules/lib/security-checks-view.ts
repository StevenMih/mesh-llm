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
import { NINE_PROPERTY_LABELS, RECOMPUTED_PROPERTIES } from '@/features/capsules/lib/nine-properties'
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
// ---------------------------------------------------------------------------

export type ChecksSideCell = {
  /** Wire state (`PASS`/`FAIL`/...). */
  state: string
  /** Lowercase manifesto word (Q1) -- `established`/`failed`/... */
  label: string
  /** L-L: the input/policy phrase that must render beside the state,
   *  always -- never a bare state word. */
  detail: string
  /** L-M: true for the two properties this page recomputes in-browser
   *  (`content_binding`, `producer_signature`) -- drives the visual
   *  distinction from sidecar-sourced properties. */
  recomputed: boolean
}

export type ChecksRow = {
  key: string
  label: string
  yours: ChecksSideCell | null
  theirs: ChecksSideCell | null
  /** `capture_coverage` only -- one line, no column split. */
  singleLine?: string
}

function yoursDetailFor(key: string, state: string, text: string | undefined): string {
  if (text) return text
  if (RECOMPUTED_PROPERTIES.has(key)) return 'recomputed in browser'
  if (state === 'NOT_PRESENT' && key === 'local_inclusion') return 'no checkpoint'
  if (state === 'NOT_PRESENT' && key === 'identity_authority') return 'no policy set'
  return 'from the record'
}

function theirsDetailFor(key: string): string {
  return RECOMPUTED_PROPERTIES.has(key) ? 'their bytes not held' : 'their log, no proof given'
}

export function buildChecksRows(row: PaneCRow, identity: RecomputedIdentity): ChecksRow[] {
  const held = theirsHeld(row)
  return Object.keys(NINE_PROPERTY_LABELS).map((key) => {
    const label = NINE_PROPERTY_LABELS[key]

    if (key === 'capture_coverage') {
      const cell = row.properties?.[key] ?? null
      return {
        key,
        label,
        yours: null,
        theirs: null,
        singleLine: cell?.text ?? 'captured at the sidecar observe path'
      }
    }

    const recomputed = RECOMPUTED_PROPERTIES.has(key)
    const yoursState = recomputed
      ? boolToWireState(key === 'content_binding' ? identity.idMatch : identity.signatureOk)
      : (row.properties?.[key]?.state ?? 'NOT_CHECKED')
    const yoursText = recomputed ? undefined : (row.properties?.[key]?.text as string | undefined)

    const yours: ChecksSideCell = {
      state: yoursState,
      label: labelForState(yoursState),
      detail: yoursDetailFor(key, yoursState, yoursText),
      recomputed
    }

    const theirs: ChecksSideCell | null = held
      ? {
          state: 'NOT_CHECKED',
          label: labelForState('NOT_CHECKED'),
          detail: theirsDetailFor(key),
          recomputed: false
        }
      : null

    return { key, label, yours, theirs }
  })
}
