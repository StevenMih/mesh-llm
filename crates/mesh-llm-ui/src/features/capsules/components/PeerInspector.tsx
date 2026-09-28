// [mesh-ledger-phase3-tables-and-modal] Part 2 — the Peer Inspector modal,
// replacing the old card's inline `expanded` accordion. Opened today from
// a `PeerTableRow` click ([ledger-T7-peers-table] rebuilt the row as a
// table cell, not a card). Mirrors the Logs Request Inspector shell
// (SharedModal + TabPanel) verbatim -- Overview / Their history ([mesh-evidence-
// history-surface]) / Timeline / Exchanges tabs. The per-exchange
// drill-down (`PeerExchangeInspector`) nests inside this modal, opened from
// either the Timeline chart or the Exchanges list -- both drive the SAME
// `selectedPoint` state, never a second, divergent detail view.
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
import { TabPanel } from '@/components/ui/TabPanel'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import type { PeerTimelinePoint } from '@/features/capsules/lib/peer-exchange-timeline'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import { peerDisplayId, theirChainSummary } from '@/features/capsules/lib/peer-row-view'
import { dealingsLines } from '@/features/capsules/lib/peer-routing-view'
import { PeerExchangeInspector } from '@/features/capsules/components/PeerExchangeInspector'
import { PeerHistoryTab } from '@/features/capsules/components/PeerHistoryTab'
import { PeerRoutingSection } from '@/features/capsules/components/PeerRoutingSection'
import type { PeerRoutingControls } from '@/features/capsules/api/usePeerBlocks'
import { PEER_INSPECTOR_HEADER, YOUR_DEALINGS_TITLE } from '@/features/capsules/lib/tooltip-copy'
import { PeerTimeline } from '@/features/capsules/components/PeerTimeline'

export type PeerInspectorProps = {
  open: boolean
  onClose: () => void
  row: PaneBRow | null
  meshStatus: PeerMeshStatus | null
  points: readonly PeerTimelinePoint[]
  /** Local block controls; absent where no host store is wired (tests). */
  routing?: PeerRoutingControls
}

type PeerInspectorTab = 'overview' | 'history' | 'timeline' | 'exchanges'

function PeerOverviewTab({ row, routing }: { row: PaneBRow; routing: PeerRoutingControls | undefined }) {
  const chain = theirChainSummary(row)

  // Accountability only: no liveness line (mesh status, latency, online) --
  // that is the Network tab's -- and no per-drill "self-reported" line, which
  // the Peers legend says once.
  return (
    <div className="flex flex-col gap-3 text-sm text-fg-dim">
      {/* §7.5: the drill answers "should I stop dealing with anyone?" --
         your dealings with them, then the local block at the bottom. */}
      <section aria-label={YOUR_DEALINGS_TITLE} className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-foreground">{YOUR_DEALINGS_TITLE}</h3>
        {dealingsLines(row).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </section>
      <p className="text-fg-faint">{chain.text}</p>
      {routing ? <PeerRoutingSection routing={routing} row={row} /> : null}
    </div>
  )
}

function PeerExchangesTab({
  points,
  onSelectPoint
}: {
  points: readonly PeerTimelinePoint[]
  onSelectPoint: (point: PeerTimelinePoint) => void
}) {
  if (points.length === 0) {
    return <p className="text-xs text-fg-faint">No individually detailed exchanges on this view yet.</p>
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {points.map((point) => (
        <li key={point.exchangeId}>
          <button
            className="w-full rounded border border-border-soft px-2.5 py-2 text-left text-xs text-fg-dim hover:bg-panel-strong"
            onClick={() => onSelectPoint(point)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-foreground">{point.exchangeId}</span>
              <StatusPill dot label={point.reconciliation} tone={toneForState(point.reconciliation)} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-fg-faint">
              <span>{point.timestamp ?? 'timestamp unavailable'}</span>
              <span aria-hidden="true">·</span>
              <span>{point.direction === 'requested' ? 'you → them' : 'them → you'}</span>
              {point.direction === 'requested' ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{point.adjudication ? point.adjudication.verdict : 'NOT_CHECKED'}</span>
                </>
              ) : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  )
}

export function PeerInspector({ open, onClose, row, points, routing }: PeerInspectorProps) {
  const [selectedPoint, setSelectedPoint] = useState<PeerTimelinePoint | null>(null)

  return (
    <>
      <SharedModal
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onClose()
        }}
        open={open}
      >
        {open && row ? (
          <SharedModalContent className="flex max-h-[min(calc(100dvh-4rem),44rem)] max-w-2xl flex-col overflow-hidden">
            <SharedModalHeader className="relative shrink-0">
              <SharedModalTitle className="font-mono">{peerDisplayId(row)}</SharedModalTitle>
              <SharedModalDescription>{PEER_INSPECTOR_HEADER}</SharedModalDescription>
              <DialogPrimitive.Close asChild>
                <Button
                  aria-label="Close peer inspector"
                  className="ui-control-ghost absolute right-2 top-2 size-8 rounded-[var(--radius)] text-fg-dim lg:right-4 lg:top-4"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <X aria-hidden="true" className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </SharedModalHeader>
            <SharedModalBody className="min-h-0 flex-1 overflow-y-auto p-0">
              {/* u100 (12): four tabs share the drill's width and a long label
                 wraps, so the strip never clips "Exchanges" off its end. */}
              <TabPanel<PeerInspectorTab>
                ariaLabel="Peer inspector sections"
                contentClassName="px-5 pb-5 pt-4"
                defaultValue="overview"
                listClassName="h-auto min-h-[56px] w-full"
                stretchTabs
                triggerClassName="h-auto min-h-[44px] whitespace-normal px-2 py-2 text-center leading-tight"
                tabs={[
                  {
                    value: 'overview',
                    label: 'Overview',
                    content: <PeerOverviewTab routing={routing} row={row} />
                  },
                  {
                    value: 'history',
                    label: 'Their log, as shown to you',
                    content: <PeerHistoryTab row={row} />
                  },
                  {
                    value: 'timeline',
                    label: 'Timeline',
                    content: <PeerTimeline onSelectPoint={setSelectedPoint} points={points} row={row} />
                  },
                  {
                    value: 'exchanges',
                    label: 'Exchanges',
                    content: <PeerExchangesTab onSelectPoint={setSelectedPoint} points={points} />
                  }
                ]}
              />
            </SharedModalBody>
          </SharedModalContent>
        ) : null}
      </SharedModal>
      <PeerExchangeInspector onClose={() => setSelectedPoint(null)} point={selectedPoint} />
    </>
  )
}
