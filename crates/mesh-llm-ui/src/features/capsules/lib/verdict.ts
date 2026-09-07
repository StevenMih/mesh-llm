// The three plain-language verdict lines that ARE the default per-card read
// (capsule_mesh_viewer.py's build_verdict), recalibrated per the explicit
// wording this dashboard tab was asked to carry: line 1 states an ATTESTATION
// (self-reported) whose INTEGRITY (signed + unaltered) is what in-browser
// recompute checks -- never "proof the claim is true". Never a fake green:
// a failed in-browser check flips the line to warn, and the witness/anchor
// line stays honestly amber until a witness checkpoint is actually supplied.
import type { CapsuleRecord, ServingProvenance, VerdictLine } from '@/features/capsules/api/types'
import { friendlyModelName, plainTokenSplit } from '@/features/capsules/lib/serving-provenance'
import { pocBlock } from '@/features/capsules/lib/serving-provenance'

export function labelCounterparty(record: CapsuleRecord): string {
  const poc = pocBlock(record)
  const crossParty = poc.cross_party as Record<string, unknown> | undefined
  const initiatorRef = crossParty?.initiator_ref
  if (!crossParty || typeof initiatorRef !== 'string' || !initiatorRef) return 'unknown'
  return `initiator:${initiatorRef.slice(0, 12)}`
}

export type VerdictInputs = {
  /** In-browser capsule_id recompute vs. the record's own capsule_id. null while checking. */
  idMatch: boolean | null
  /** In-browser COSE_Sign1 EdDSA verify against the node's public key. null while checking
   * or when no signed statement / public key was found to check against. */
  signatureOk: boolean | null
  hasWitnessCheckpoint: boolean
  counterparty: string
}

export function buildVerdict(sp: ServingProvenance, inputs: VerdictInputs): VerdictLine[] {
  const name = friendlyModelName(sp)
  const gpu = sp.gpu
  let hw = gpu ? ` on ${gpu}` : ''
  if (sp.isSoc && gpu) hw = ` on ${gpu} (Apple silicon)`
  const split = plainTokenSplit(sp)

  // Line 1 -- the self-reported attestation. Integrity (signed + unaltered),
  // never "proof the claim is true".
  let line1: VerdictLine
  if (!sp.model) {
    line1 = { mark: 'warn', text: "No serving-provenance in this record — can't say what ran." }
  } else if (inputs.idMatch === false) {
    line1 = {
      mark: 'warn',
      text: `Attests it ran on ${name}${hw} (self-reported) — but this record's content does NOT recompute to its own capsule_id here. Treat it as altered.`
    }
  } else {
    line1 = {
      mark: 'ok',
      text: `Attests it ran on ${name}${hw} (self-reported)${split ? `, ${split}` : ''} — recompute in-browser that this record is signed+unaltered.`
    }
  }

  // Line 2 -- signed + anchored. Honest amber unless a witness receipt rides along.
  let line2: VerdictLine
  if (inputs.signatureOk === true) {
    line2 = {
      mark: inputs.hasWitnessCheckpoint ? 'ok' : 'warn',
      text: inputs.hasWitnessCheckpoint
        ? 'Signed by the provider (verified here) and anchored to a public witness, so it can’t be quietly changed.'
        : 'Provider-signed — the signature verifies here against the node’s public key — but the witness receipt isn’t in this bundle, so anchoring isn’t shown in this view.'
    }
  } else if (inputs.signatureOk === false) {
    line2 = {
      mark: 'warn',
      text: 'Signature does NOT verify against the node’s public key here — treat this record as unauthenticated.'
    }
  } else {
    line2 = {
      mark: 'warn',
      text: 'No signed statement / node public key found in this bundle, so the provider signature can’t be checked here.'
    }
  }

  // Line 3 -- the open gap, stated plainly.
  const line3: VerdictLine =
    inputs.counterparty && inputs.counterparty !== 'unknown'
      ? { mark: 'ok', text: `Who asked is attested (${inputs.counterparty}).` }
      : {
          mark: 'warn',
          text: "Not yet proven: who asked (the requester is self-attested, not named) — and this node's track record isn't carried in a single record."
        }

  return [line1, line2, line3]
}
