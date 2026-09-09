// [mesh-ledger-peers-tab] Phase 1 — one inline card per peer, catalog-card
// grammar (mirrors the Network Model-catalog's `ModelRow`: left icon,
// bold mono title, meta row, right-side status/alarm chips). Honesty
// backbone: with-you counts and their-chain text are never summed, the
// adjudication line always carries a denominator, and the alarm chip is
// the only element guaranteed visible when the card is collapsed.
import { Users } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { AccentIconFrame } from '@/components/ui/AccentIconFrame'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import {
  adjudicationSummary,
  adjudicationSummaryText,
  alarmSignal,
  peerDisplayId,
  theirChainSummary,
  withYouCounts,
  withYouCountsText
} from '@/features/capsules/lib/peer-row-view'

export type PeerCardProps = {
  row: PaneBRow
  meshStatus: PeerMeshStatus | null
  resolveTimestamp?: (capsuleId: string) => string | null
}

function meshMetaLine(meshStatus: PeerMeshStatus | null): string | null {
  if (!meshStatus) return null
  const parts = [
    meshStatus.modelName,
    meshStatus.quant,
    meshStatus.contextLengthK != null ? `${meshStatus.contextLengthK}k ctx` : null
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : null
}

export function PeerCard({ row, meshStatus, resolveTimestamp }: PeerCardProps) {
  const navigate = useNavigate()
  const displayId = peerDisplayId(row)
  const counts = withYouCounts(row)
  const adjudication = adjudicationSummary(row)
  const chain = theirChainSummary(row)
  const alarm = alarmSignal(row, resolveTimestamp)

  const online = meshStatus?.online ?? false
  const metaLine = meshMetaLine(meshStatus)
  const latencyLabel = meshStatus?.latencyMs != null ? `${meshStatus.latencyMs} ms` : 'latency unknown'
  const canRouteToChat = Boolean(meshStatus?.modelName)

  return (
    <Card className="mb-2">
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
          {/* Always rendered when present, even though the card has no
             collapsed/expanded state distinction yet (that lands in
             Phase 2) — a bad peer must never be able to hide. */}
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
        <p className="text-fg-faint">{chain.text}</p>
        <div className="pt-1">
          <button
            className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canRouteToChat}
            onClick={() => {
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
  )
}
