// Shared in-browser recompute for `content_binding` (capsule_id) and
// `producer_signature`, factored out of `CapsuleCard.tsx`'s effect so the
// Ledger Panes section ([mesh-live-tab-pane-proxy] build item 2) can apply
// the SAME rule to sidecar-served rows: "the live tab keeps recomputing
// capsule_id + signature itself and must never trust a chip it did not
// recompute for those two properties" -- a pane's own JSON `verify_ok` /
// `properties.content_binding` / `properties.producer_signature` are
// display hints at best; this hook is the one and only place either
// property's real PASS/FAIL is decided for the panes.
import { useEffect, useState } from 'react'
import { fetchSignedStatement } from '@/features/capsules/api/client'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { recomputeCapsuleId } from '@/features/capsules/lib/canonical'
import { ed25519PublicKeyFromSpkiPem, verifyCoseSign1 } from '@/features/capsules/lib/cose'

export type RecomputedIdentity = {
  /** `null` while pending or when recompute could not run at all (e.g. no full record available). */
  idMatch: boolean | null
  signatureOk: boolean | null
}

const PENDING: RecomputedIdentity = { idMatch: null, signatureOk: null }

async function recompute(record: CapsuleRecord, nodePubKeyPem: string | null): Promise<RecomputedIdentity> {
  let idMatch: boolean | null
  try {
    const recomputed = await recomputeCapsuleId(record)
    idMatch = record.capsule_id ? recomputed === record.capsule_id : null
  } catch {
    idMatch = null
  }

  if (!nodePubKeyPem || !record.capsule_id) return { idMatch, signatureOk: null }

  try {
    const statementBytes = await fetchSignedStatement(record.capsule_id)
    if (!statementBytes) return { idMatch, signatureOk: null }
    const publicKey = ed25519PublicKeyFromSpkiPem(nodePubKeyPem)
    const verified = verifyCoseSign1(statementBytes, publicKey)
    return { idMatch, signatureOk: verified.verified }
  } catch {
    return { idMatch, signatureOk: null }
  }
}

/**
 * Recomputes `capsule_id` from `record` and, when `nodePubKeyPem` is known,
 * verifies the detached COSE_Sign1 signed statement for it. `record` may be
 * `null` when a pane row did not carry the full record this node needs to
 * recompute against (e.g. a counterparty's half in Pane C) -- that is
 * reported as `null`/`null`, never silently upgraded to a trusted PASS.
 *
 * While a new `record` is in flight, this returns `PENDING` (derived at
 * render time from the key mismatch below, never from a synchronous
 * `setState` inside the effect) rather than the previous record's result.
 */
export function useRecomputedIdentity(record: CapsuleRecord | null, nodePubKeyPem: string | null): RecomputedIdentity {
  const recordKey = record?.capsule_id ?? null
  const [resolved, setResolved] = useState<{
    key: string | null
    nodePubKeyPem: string | null
    result: RecomputedIdentity
  }>({
    key: null,
    nodePubKeyPem: null,
    result: PENDING
  })

  useEffect(() => {
    if (!record) return undefined
    let cancelled = false
    void recompute(record, nodePubKeyPem).then((result) => {
      if (!cancelled) setResolved({ key: recordKey, nodePubKeyPem, result })
    })
    return () => {
      cancelled = true
    }
  }, [record, recordKey, nodePubKeyPem])

  if (!record) return PENDING
  if (resolved.key !== recordKey || resolved.nodePubKeyPem !== nodePubKeyPem) return PENDING
  return resolved.result
}
