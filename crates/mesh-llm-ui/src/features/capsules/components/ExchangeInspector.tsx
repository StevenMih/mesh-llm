// [mesh-ledger-phase3-tables-and-modal] Part 3 — the Exchanges table's row
// inspector: the full nine-property "security checks" detail (all the
// chips) that used to live in the card's collapsed accordion, now the
// modal's whole body. Same SharedModal shell as the Peer/Log inspectors.
import { useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusPill } from '@/components/ui/status-pill'
import {
  SharedModal,
  SharedModalBody,
  SharedModalContent,
  SharedModalDescription,
  SharedModalHeader,
  SharedModalTitle
} from '@/components/ui/SharedModal'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import { DeclareBreakDialog } from '@/features/capsules/components/DeclareBreakDialog'
import { NINE_PROPERTY_LABELS } from '@/features/capsules/lib/nine-properties'
import { useRecomputedIdentity } from '@/features/capsules/lib/recompute-identity'

export type ExchangeInspectorProps = {
  row: PaneCRow | null
  counterparty: string | null
  localRecord: CapsuleRecord | null
  nodePubKeyPem: string | null
  onClose: () => void
}

function boolToTone(value: boolean | null) {
  return value === null ? ('neutral' as const) : value ? ('good' as const) : ('bad' as const)
}

function boolToState(value: boolean | null): string {
  return value === null ? 'NOT_CHECKED' : value ? 'PASS' : 'FAIL'
}

export function ExchangeInspector({ row, counterparty, localRecord, nodePubKeyPem, onClose }: ExchangeInspectorProps) {
  const identity = useRecomputedIdentity(localRecord, nodePubKeyPem)
  const [showDeclareDialog, setShowDeclareDialog] = useState(false)
  const confirmed = row ? row.theirs.state !== 'absent' && !row.unilateral : false

  return (
    <SharedModal
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      open={row !== null}
    >
      {row ? (
        <SharedModalContent className="max-w-lg">
          <SharedModalHeader className="relative">
            <SharedModalTitle className="font-mono">{row.exchange_key}</SharedModalTitle>
            <SharedModalDescription>
              {row.timestamp ?? 'timestamp unavailable'} · {row.role_tag === 'SERVED' ? 'you served' : 'you asked'}
              {counterparty ? ` · ${counterparty}` : ''}
            </SharedModalDescription>
            <DialogPrimitive.Close asChild>
              <Button
                aria-label="Close exchange inspector"
                className="ui-control-ghost absolute right-2 top-2 size-8 rounded-[var(--radius)] text-fg-dim"
                size="icon"
                type="button"
                variant="ghost"
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </SharedModalHeader>
          <SharedModalBody className="flex flex-col gap-3 text-sm text-fg-dim">
            <StatusPill
              dot
              label={confirmed ? 'confirmed' : 'not yet confirmed'}
              tone={confirmed ? 'good' : 'neutral'}
            />
            <div>
              <p className="text-xs font-medium text-fg-faint">Your capsule</p>
              <p className="font-mono text-xs">{row.mine.capsule_id ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-fg-faint">Their capsule reference</p>
              <p className="font-mono text-xs">{row.theirs.capsule_id ?? '—'}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-fg-dim">Security checks</p>
              <ol className="flex flex-col gap-1.5">
                {Object.keys(NINE_PROPERTY_LABELS).map((propKey) => {
                  const label = NINE_PROPERTY_LABELS[propKey] ?? propKey.replace(/_/g, ' ')
                  if (propKey === 'content_binding') {
                    return (
                      <li key={propKey} className="flex items-center gap-2 text-xs">
                        <StatusPill
                          label={`${label}: ${boolToState(identity.idMatch)} (recomputed)`}
                          tone={boolToTone(identity.idMatch)}
                          tooltip="recomputed in this browser — not taken from the data source"
                        />
                      </li>
                    )
                  }
                  if (propKey === 'producer_signature') {
                    return (
                      <li key={propKey} className="flex items-center gap-2 text-xs">
                        <StatusPill
                          label={`${label}: ${boolToState(identity.signatureOk)} (recomputed)`}
                          tone={boolToTone(identity.signatureOk)}
                          tooltip="recomputed in this browser — not taken from the data source"
                        />
                      </li>
                    )
                  }
                  const cell = row.properties?.[propKey]
                  const state = cell?.state ?? 'NOT_CHECKED'
                  return (
                    <li key={propKey} className="flex items-center gap-2 text-xs">
                      <StatusPill
                        label={`${label}: ${state}`}
                        tone={toneForState(state)}
                        tooltip={cell?.text ?? undefined}
                      />
                    </li>
                  )
                })}
              </ol>
            </div>
            <p className="text-xs text-fg-faint">recomputed and verified in your browser, not asserted by this page</p>
            {/* 8. Actions for FAIL states — L3.5 vocabulary: never "Repair",
               evidence is added, not fixed. */}
            {row.has_issue ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-xs text-fg-faint">Actions: </span>
                  <button
                    type="button"
                    className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
                  >
                    Restore from copies
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeclareDialog((v) => !v)}
                    className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
                  >
                    Declare the break
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
                  >
                    Ask them for their copy
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
                  >
                    Record this
                  </button>
                  <button
                    type="button"
                    className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card"
                  >
                    Stop using this node
                  </button>
                </div>
                {showDeclareDialog ? (
                  <DeclareBreakDialog
                    onConfirm={() => setShowDeclareDialog(false)}
                    onCancel={() => setShowDeclareDialog(false)}
                  />
                ) : null}
              </div>
            ) : null}
          </SharedModalBody>
        </SharedModalContent>
      ) : null}
    </SharedModal>
  )
}
