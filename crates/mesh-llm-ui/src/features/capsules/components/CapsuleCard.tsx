import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { fetchSignedStatement } from '@/features/capsules/api/client'
import type { CapsuleRecord, JsonRecord } from '@/features/capsules/api/types'
import { reconcileAdvertisedVsServed } from '@/features/capsules/lib/advertisement'
import { digestFacts, recomputeCapsuleId } from '@/features/capsules/lib/canonical'
import { ed25519PublicKeyFromSpkiPem, verifyCoseSign1 } from '@/features/capsules/lib/cose'
import {
  friendlyModelName,
  plainGenParamsLine,
  plainModelLine,
  pocBlock,
  servingProvenance
} from '@/features/capsules/lib/serving-provenance'
import { buildVerdict, labelCounterparty } from '@/features/capsules/lib/verdict'

type CapsuleCardProps = {
  record: CapsuleRecord
  nodePubKeyPem: string | null
}

type ResponseFactsCheck = { sealedDigest: string | null; computedDigest: string | null; matches: boolean | null }

export function CapsuleCard({ record, nodePubKeyPem }: CapsuleCardProps) {
  const capsuleId = record.capsule_id ?? '(none)'
  const sp = servingProvenance(record)
  const friendlyModel = friendlyModelName(sp)
  const modelLine = plainModelLine(sp)
  const genParamsLine = plainGenParamsLine(sp)
  const counterparty = labelCounterparty(record)

  const [recomputedId, setRecomputedId] = useState<string | null>(null)
  const [idMatch, setIdMatch] = useState<boolean | null>(null)
  const [signatureOk, setSignatureOk] = useState<boolean | null>(null)
  const [responseCheck, setResponseCheck] = useState<ResponseFactsCheck | null>(null)

  useEffect(() => {
    let cancelled = false
    async function verify() {
      try {
        const recomputed = await recomputeCapsuleId(record)
        if (cancelled) return
        setRecomputedId(recomputed)
        setIdMatch(record.capsule_id ? recomputed === record.capsule_id : null)
      } catch {
        if (!cancelled) setIdMatch(null)
      }

      if (nodePubKeyPem && record.capsule_id) {
        try {
          const statementBytes = await fetchSignedStatement(record.capsule_id)
          if (cancelled) return
          if (statementBytes) {
            const publicKey = ed25519PublicKeyFromSpkiPem(nodePubKeyPem)
            const result = verifyCoseSign1(statementBytes, publicKey)
            setSignatureOk(result.verified)
          } else {
            setSignatureOk(null)
          }
        } catch {
          if (!cancelled) setSignatureOk(null)
        }
      }

      const effect = (record.effect as JsonRecord | undefined) ?? {}
      const sealedDigest = typeof effect.response_digest === 'string' ? effect.response_digest : null
      if (sp.model != null && sp.promptTokens != null && sp.completionTokens != null && sp.totalTokens != null) {
        try {
          const facts = {
            model: sp.model,
            usage: {
              prompt_tokens: sp.promptTokens,
              completion_tokens: sp.completionTokens,
              total_tokens: sp.totalTokens
            }
          }
          const computed = await digestFacts(facts)
          if (!cancelled) {
            setResponseCheck({
              sealedDigest,
              computedDigest: computed,
              matches: sealedDigest != null && computed === sealedDigest
            })
          }
        } catch {
          if (!cancelled) setResponseCheck({ sealedDigest, computedDigest: null, matches: null })
        }
      } else if (sealedDigest) {
        setResponseCheck({ sealedDigest, computedDigest: null, matches: null })
      }
    }
    void verify()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.capsule_id, nodePubKeyPem])

  const verdict = buildVerdict(sp, {
    idMatch,
    signatureOk,
    hasWitnessCheckpoint: false,
    counterparty
  })

  const poc = pocBlock(record)
  const advertisement = poc.advertisement as JsonRecord | undefined
  const rawServingProvenance = poc.serving_provenance as JsonRecord | undefined
  const reconciliation = reconcileAdvertisedVsServed(advertisement, rawServingProvenance)

  const sealedLabel =
    idMatch === true
      ? 'sealed — integrity confirmed here'
      : idMatch === false
        ? 'sealed — MISMATCH'
        : 'sealed — checking…'
  const sealedTone = idMatch === true ? 'ok' : idMatch === false ? 'fail' : 'muted'

  return (
    <Card className="mb-4">
      <CardHeader className="flex-row items-baseline justify-between gap-3">
        <CardTitle className="text-base">{friendlyModel}</CardTitle>
        <Badge
          className={cn(
            sealedTone === 'ok' && 'border-emerald-600/40 bg-emerald-600/10 text-emerald-500',
            sealedTone === 'fail' && 'border-red-600/40 bg-red-600/10 text-red-500'
          )}
        >
          {sealedLabel}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          {verdict.map((line, idx) => (
            <li key={idx} className={cn('flex gap-2 text-sm leading-snug', line.mark === 'warn' && 'text-amber-500')}>
              <span aria-hidden="true">{line.mark === 'ok' ? '✓' : '⚠'}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>

        <div className="rounded-md border border-border/60 bg-muted/30 p-2 font-mono text-xs text-muted-foreground">
          <div>recorded (self-reported): {modelLine}</div>
          {genParamsLine ? <div className="mt-1">{genParamsLine}</div> : null}
        </div>

        <AdvertisedVsServed reconciliation={reconciliation} />

        <details className="rounded-md border border-border/60 text-xs">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium text-muted-foreground">
            Show the security checks
          </summary>
          <div className="space-y-1 px-3 pb-3 font-mono text-muted-foreground">
            <div>capsule_id: {capsuleId}</div>
            <div>recomputed in-browser: {recomputedId ?? '(not recomputable)'}</div>
            <div>id matches: {idMatch === true ? 'yes' : idMatch === false ? 'NO' : 'n/a'}</div>
            <div>
              signature (COSE_Sign1 vs node pubkey):{' '}
              {signatureOk === true ? 'verifies' : signatureOk === false ? 'DOES NOT VERIFY' : 'not checkable here'}
            </div>
            <div>raw model ref: {sp.modelCanonicalRef ?? sp.model ?? '(no raw ref)'}</div>
            {sp.modelIdentityHash ? <div>model_identity_hash: {sp.modelIdentityHash}</div> : null}
            {sp.servedByNodeId ? <div>served_by_node_id: {sp.servedByNodeId}</div> : null}
            {responseCheck ? (
              <div>
                served-facts digest vs sealed response_digest:{' '}
                {responseCheck.matches === true
                  ? 'matches'
                  : responseCheck.matches === false
                    ? 'MISMATCH'
                    : 'sealed, not checkable'}
              </div>
            ) : null}
          </div>
        </details>
      </CardContent>
    </Card>
  )
}

function AdvertisedVsServed({ reconciliation }: { reconciliation: ReturnType<typeof reconcileAdvertisedVsServed> }) {
  const { overall, mismatches } = reconciliation
  if (overall === 'match') {
    return (
      <p className="text-xs text-muted-foreground">
        Advertised vs. served: <span className="text-emerald-500">match</span> — no broken promise in what was both
        claimed and served (both self-attested by this node).
      </p>
    )
  }
  if (overall === 'mismatch') {
    return (
      <p className="text-xs text-amber-500">
        Advertised vs. served: <span className="font-semibold">MISMATCH</span> ({mismatches.join(', ')}) — this node
        advertised one thing and served another.
      </p>
    )
  }
  const why =
    overall === 'advertisement_absent'
      ? 'no advertisement was co-carried to reconcile against'
      : 'no served facts to reconcile'
  return (
    <p className="text-xs text-muted-foreground">
      Advertised vs. served: <span className="font-medium">{overall}</span> — {why}, so this is recorded but there is no
      kept-or-broken promise to check (not a pass).
    </p>
  )
}
