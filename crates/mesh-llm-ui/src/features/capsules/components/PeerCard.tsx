// [mesh-ledger-peers-tab] Phase 1, [mesh-ledger-phase3-tables-and-modal]
// Part 2 — one card per peer, catalog-card grammar (mirrors the Network
// Model-catalog's `ModelRow`: left icon, bold mono title, meta row,
// right-side status/alarm chips). The row is the scannable summary; the
// one-timeline view + per-exchange drill-down live in the `PeerInspector`
// modal (SharedModal pop-out, same shell as the Logs Request Inspector) —
// clicking the row opens it, "Route here" stays the one explicit button.
// Honesty backbone: with-you counts and their-chain text are never summed,
// the adjudication line always carries a denominator, and the alarm chip
// is the only element guaranteed visible when the modal is closed.
import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { AccentIconFrame } from '@/components/ui/AccentIconFrame'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import { PeerInspector } from '@/features/capsules/components/PeerInspector'
import { buildTimelinePoints, type PeerExchangeSource } from '@/features/capsules/lib/peer-exchange-timeline'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import {
  adjudicationSummary,
  adjudicationSummaryText,
  alarmSignal,
  meshMetaLine,
  peerDisplayId,
  withYouCounts,
  withYouCountsText
} from '@/features/capsules/lib/peer-row-view'

export type PeerCardProps = {
  row: PaneBRow
  meshStatus: PeerMeshStatus | null
  resolveTimestamp?: (capsuleId: string) => string | null
  exchangeSources?: readonly PeerExchangeSource[]
  recordsById?: ReadonlyMap<string, CapsuleRecord>
}

const EMPTY_SOURCES: readonly PeerExchangeSource[] = []
const EMPTY_RECORDS: ReadonlyMap<string, CapsuleRecord> = new Map()

export function PeerCard({
  row,
  meshStatus,
  resolveTimestamp,
  exchangeSources = EMPTY_SOURCES,
  recordsById = EMPTY_RECORDS
}: PeerCardProps) {
  const navigate = useNavigate()
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const displayId = peerDisplayId(row)
  const counts = withYouCounts(row)
  const adjudication = adjudicationSummary(row)
  const alarm = alarmSignal(row, resolveTimestamp)
  const points = useMemo(
    () => buildTimelinePoints(row, exchangeSources, recordsById),
    [row, exchangeSources, recordsById]
  )

  const online = meshStatus?.online ?? false
  const metaLine = meshMetaLine(meshStatus)
  const latencyLabel = meshStatus?.latencyMs != null ? `${meshStatus.latencyMs} ms` : 'latency unknown'
  const canRouteToChat = Boolean(meshStatus?.modelName)

  return (
    <>
      <Card
        aria-label={`Open peer inspector for ${displayId}`}
        className="mb-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        onClick={() => setInspectorOpen(true)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
          event.preventDefault()
          setInspectorOpen(true)
        }}
        tabIndex={0}
      >
        <CardHeader className="grid grid-cols-[auto_1fr_auto] items-start gap-3 pb-2">
          <AccentIconFrame className="size-9 self-start" tone="subtle">
            <Users aria-hidden="true" className="size-4" strokeWidth={1.8} />
          </AccentIconFrame>
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-medium text-foreground">{displayId}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-faint">
              {metaLine ? <span className="font-mono">{metaLine}</span> : <span>mesh status not available</span>}
              <span aria-hidden="true">·</span>
              <span className="font-mono">{latencyLabel}</span>
            </div>
            <p className="mt-1 text-xs text-fg-faint">self-reported — not independently attested</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <StatusBadge dot size="caption" tone={meshStatus ? (online ? 'good' : 'muted') : 'muted'}>
              {meshStatus ? (online ? 'online' : 'offline') : 'status unknown'}
            </StatusBadge>
            {/* Always rendered, whether or not the inspector is open — a
               bad peer must never be able to hide. The modal enumerates
               every alarm (incl. a broken chain) in full; this chip is the
               ONLY place that fact renders on the row, never doubled. */}
            {alarm.present ? (
              <StatusBadge size="caption" tone={alarm.tone}>
                ⚠ {alarm.text}
              </StatusBadge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 pt-0 text-xs text-fg-dim">
          <p>{withYouCountsText(counts)}</p>
          <p>{adjudicationSummaryText(adjudication)}</p>
          <div className="flex items-center gap-2 pt-1">
            <button
              className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canRouteToChat}
              onClick={(event) => {
                event.stopPropagation()
                if (meshStatus?.modelName) navigate({ search: { model: meshStatus.modelName }, to: '/chat' })
              }}
              title={canRouteToChat ? undefined : 'No mesh status available for this peer yet'}
              type="button"
            >
              Route here
            </button>
          </div>
        </CardContent>
      </Card>
      <PeerInspector
        meshStatus={meshStatus}
        onClose={() => setInspectorOpen(false)}
        open={inspectorOpen}
        points={points}
        row={row}
      />
    </>
  )
}
