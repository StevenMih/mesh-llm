// Pure view-model derivation for the TWIN bracket's COMPARISON block
// ([ledger-T11-twins-visible], v3 §5). Kept separate from `TwinBracket.tsx`
// so the honesty invariants below are unit-testable without mounting a
// component:
//   - the disclosure sentence's N is READ from the live configured rate
//     (a prop threaded from the wire payload), never a hardcoded constant;
//   - OBSERVE-ONLY (item 4): this module computes no verdict at all -- not
//     even a PASS/FAIL string -- because the underlying live dual-dispatch
//     that would justify one doesn't exist yet (see the Rust host's
//     `runtime::twin_sample` module doc). It surfaces only what the two
//     halves themselves recorded (parameters, raw response text for a real
//     diff), never an equality/inconclusive judgment call.
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import type { TwinPolicy } from '@/lib/api/types'

/**
 * "This comparison ran automatically — 1 in N exchanges is sent to a second
 * peer." (v3 §5 "Ambient twins are unannounced, and the ledger says so.")
 * `oneInN` must come from the LIVE configured rate (today: the sidecar's
 * `twin_sample_rate_denominator`, ultimately sourced from the Rust host's
 * `twin_sample::configured_twin_sample_rate`) -- this function has no
 * built-in default and will not silently print "50" when the caller didn't
 * supply one; `null` degrades to a rate-free disclosure sentence instead.
 */
export function twinDisclosureSentence(oneInN: number | null): string {
  if (oneInN === null) {
    return 'This comparison ran automatically — sent to a second peer.'
  }
  return `This comparison ran automatically — 1 in ${oneInN} exchanges is sent to a second peer.`
}

export const PUBLIC_MESH_TWIN_OFF_SENTENCE =
  'Twinning is off on the public mesh: a twin sends your request content to a second peer, and here that peer could be a stranger.'

/**
 * The disclosure sentence as the LIVE twin policy (`/api/status`
 * `twin_policy`) dictates: on a public mesh with no trust-policy opt-in,
 * the "off" sentence; otherwise the rate sentence with the policy's N.
 * With no policy from the host (an older host), falls back to
 * `fallbackOneInN`, the sidecar-reported rate.
 */
export function twinPolicyDisclosureSentence(
  policy: TwinPolicy | null | undefined,
  fallbackOneInN: number | null
): string {
  if (policy?.public_mesh_twin_disabled) return PUBLIC_MESH_TWIN_OFF_SENTENCE
  return twinDisclosureSentence(policy ? policy.twin_sample_rate_denominator : fallbackOneInN)
}

/**
 * The COMPARISON block's parameters line -- "temp 0 · seed 1 · model
 * identity d41d… · settings KV F16/F16" (v3 §5) -- built from whatever
 * fields the bracket's rows actually carry. Any missing field is simply
 * skipped (never a fabricated placeholder); `null` when NEITHER row carries
 * any comparison data at all, so callers can omit the line entirely rather
 * than render an empty one.
 */
export function twinComparisonParametersLine(rows: readonly ExchangeLedgerRow[]): string | null {
  const comparison = rows.map((row) => row.raw.twin_comparison).find((value) => value != null)
  if (!comparison) return null

  const parts: string[] = []
  if (comparison.temperature !== undefined && comparison.temperature !== null) {
    parts.push(`temp ${comparison.temperature}`)
  }
  if (comparison.seed !== undefined && comparison.seed !== null) {
    parts.push(`seed ${comparison.seed}`)
  }
  if (comparison.model_identity_hash) {
    parts.push(`model identity ${comparison.model_identity_hash}`)
  }
  if (comparison.settings_label) {
    parts.push(`settings ${comparison.settings_label}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The raw response text held on each side of the bracket, for the ONE real
 * side-by-side diff this ledger can show (v3 §5: "Because you were the
 * requester to both, you hold both responses"). `[null, null]` (or a
 * partial pair) when either side hasn't populated `mine.text` -- never
 * invented content to diff against.
 */
export function twinResponseTexts(rows: readonly ExchangeLedgerRow[]): [string | null, string | null] {
  const [a, b] = rows
  return [a?.raw.mine.text ?? null, b?.raw.mine.text ?? null]
}
