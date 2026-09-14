// [ledger-T7-peers-table] One row of the Peers table (replaces the old
// `PeerCard` -- review §3-F: "Peers is a card, not the table"). Block A/B/C
// each get their own cell, never blended into one paragraph. A row with
// exchange history opens the same `PeerInspector` modal PeerCard used to;
// an "advertised but unused" row (no `PaneBRow` at all) has nothing to
// drill into, so it isn't clickable.
import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { TableCell, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { PeerInspector } from '@/features/capsules/components/PeerInspector'
import { buildTimelinePoints, type PeerExchangeSource } from '@/features/capsules/lib/peer-exchange-timeline'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import { SELF_REPORTED_NOTE, type PeerTableRowView } from '@/features/capsules/lib/peer-row-view'

export type PeerTableBlockKey = 'A' | 'B' | 'C'

export type PeerTableRowProps = {
  view: PeerTableRowView
  meshStatus: PeerMeshStatus | null
  exchangeSources?: readonly PeerExchangeSource[]
  recordsById?: ReadonlyMap<string, CapsuleRecord>
  /** Columns toggle ([ledger-T7-peers-table]'s toolbar) -- Node/Alarm/
   *  Actions are never hideable, only the three fact blocks are. */
  visibleBlocks?: ReadonlySet<PeerTableBlockKey>
}

const EMPTY_SOURCES: readonly PeerExchangeSource[] = []
const EMPTY_RECORDS: ReadonlyMap<string, CapsuleRecord> = new Map()
const ALL_BLOCKS: ReadonlySet<PeerTableBlockKey> = new Set(['A', 'B', 'C'])

export function PeerTableRow({
  view,
  meshStatus,
  exchangeSources = EMPTY_SOURCES,
  recordsById = EMPTY_RECORDS,
  visibleBlocks = ALL_BLOCKS
}: PeerTableRowProps) {
  const navigate = useNavigate()
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const points = useMemo(
    () => (view.row ? buildTimelinePoints(view.row, exchangeSources, recordsById) : []),
    [view.row, exchangeSources, recordsById]
  )
  const inspectable = view.row !== null
  const openInspector = () => setInspectorOpen(true)

  return (
    <>
      <TableRow
        aria-label={inspectable ? `Open peer inspector for ${view.displayId}` : undefined}
        className={
          inspectable
            ? 'cursor-pointer align-top outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'
            : 'align-top'
        }
        onClick={inspectable ? openInspector : undefined}
        onKeyDown={
          inspectable
            ? (event) => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                event.preventDefault()
                openInspector()
              }
            : undefined
        }
        tabIndex={inspectable ? 0 : undefined}
      >
        <TableCell>
          <div className="flex flex-col items-start gap-1.5">
            <span className="truncate font-mono text-sm font-medium text-foreground">{view.displayId}</span>
            <StatusBadge dot size="caption" tone={meshStatus ? (view.online ? 'good' : 'muted') : 'muted'}>
              {meshStatus ? (view.online ? 'online' : 'offline') : 'status unknown'}
            </StatusBadge>
            {/* Always rendered, whether or not the inspector is open --
               chooser-v2 §3-F: "⚠ alarm chip visible while collapsed". The
               modal enumerates every alarm in full; this chip is the ONLY
               place the fact renders on the row, never doubled. */}
            {view.alarm.present ? (
              <StatusBadge size="caption" tone={view.alarm.tone}>
                ⚠ {view.alarm.text}
              </StatusBadge>
            ) : null}
          </div>
        </TableCell>
        {visibleBlocks.has('A') ? (
          <TableCell className="text-xs text-fg-dim">
            <div className="flex flex-col gap-1">
              {view.blockA ? <span className="font-mono">{view.blockA}</span> : <span>mesh status not available</span>}
              {/* chooser-v2 §3: no colour, "self-reported" stated once. */}
              <span className="text-fg-faint">{SELF_REPORTED_NOTE}</span>
            </div>
          </TableCell>
        ) : null}
        {visibleBlocks.has('B') ? (
          <TableCell className="text-xs text-fg-dim">
            <div className="flex flex-col gap-1">
              <span>{view.blockBCounts}</span>
              <span className="font-mono">{view.blockBLatency}</span>
              {view.blockBAnswered ? <span>{view.blockBAnswered}</span> : null}
            </div>
          </TableCell>
        ) : null}
        {visibleBlocks.has('C') ? (
          <TableCell className="text-xs text-fg-dim">
            <div className="flex flex-col gap-1">
              <span>{view.blockCAdjudication}</span>
              <span className="text-fg-faint">{view.blockCWitness}</span>
            </div>
          </TableCell>
        ) : null}
        <TableCell>
          <div className="flex flex-col items-start gap-1">
            {/* R-E: identical chrome everywhere, never disabled by an
               outcome -- only ever disabled by the fact that no mesh
               status resolved for this peer. */}
            <button
              className="rounded border border-border/60 px-2 py-0.5 text-xs text-fg-dim hover:bg-card disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!view.canRouteToChat}
              onClick={(event) => {
                event.stopPropagation()
                if (meshStatus?.modelName) navigate({ search: { model: meshStatus.modelName }, to: '/chat' })
              }}
              type="button"
            >
              Route here
            </button>
            {/* review §3-F: the disabled reason must be VISIBLE text, never
               hidden in a tooltip/aria-only attribute. */}
            {!view.canRouteToChat && view.routeDisabledReason ? (
              <span className="text-[11px] text-fg-faint">{view.routeDisabledReason}</span>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {view.row ? (
        <PeerInspector
          meshStatus={meshStatus}
          onClose={() => setInspectorOpen(false)}
          open={inspectorOpen}
          points={points}
          row={view.row}
        />
      ) : null}
    </>
  )
}
