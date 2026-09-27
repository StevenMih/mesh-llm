// [ledger-T7-peers-table] One row of the Peers table (replaces the old
// `PeerCard` -- review §3-F: "Peers is a card, not the table"). Each
// accountability column gets its own cell, never blended into one
// paragraph. A row with exchange history opens the same `PeerInspector`
// modal PeerCard used to; an "advertised but unused" row (no `PaneBRow` at
// all) has nothing to drill into, so it isn't clickable.
//
// [a18-evidence-peers-dedup-network] No online badge, latency, or
// Route-to-chat button here -- those are Network's job. `meshStatus` is
// still threaded through to `PeerInspector` (the deep-dive modal keeps its
// own operational Overview tab), just no longer rendered on the row.
import { useMemo, useState } from 'react'
import { TableCell, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { PeerInspector } from '@/features/capsules/components/PeerInspector'
import { buildTimelinePoints, type PeerExchangeSource } from '@/features/capsules/lib/peer-exchange-timeline'
import type { PeerMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import {
  ALL_PEER_TABLE_COLUMNS,
  type PeerTableColumnKey,
  type PeerTableRowView
} from '@/features/capsules/lib/peer-row-view'
import { HoverChip } from '@/features/capsules/components/HoverChip'
import { PEER_PAYMENTS_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'
import type { PeerRoutingControls } from '@/features/capsules/api/usePeerBlocks'
import { routableNodeId, routingState } from '@/features/capsules/lib/peer-routing-view'
import { ROUTING_STOPPED_LABEL, ROUTING_STOPPED_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'

export type PeerTableRowProps = {
  view: PeerTableRowView
  meshStatus: PeerMeshStatus | null
  exchangeSources?: readonly PeerExchangeSource[]
  recordsById?: ReadonlyMap<string, CapsuleRecord>
  /** Columns toggle ([ledger-T7-peers-table]'s toolbar) -- Peer/Alarm are
   *  never hideable, only the six accountability columns are. */
  visibleColumns?: ReadonlySet<PeerTableColumnKey>
  /** Local block controls (§7.5); absent where no host store is wired. */
  routing?: PeerRoutingControls
}

const EMPTY_SOURCES: readonly PeerExchangeSource[] = []
const EMPTY_RECORDS: ReadonlyMap<string, CapsuleRecord> = new Map()

export function PeerTableRow({
  view,
  meshStatus,
  exchangeSources = EMPTY_SOURCES,
  recordsById = EMPTY_RECORDS,
  visibleColumns = ALL_PEER_TABLE_COLUMNS,
  routing
}: PeerTableRowProps) {
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const points = useMemo(
    () => (view.row ? buildTimelinePoints(view.row, exchangeSources, recordsById) : []),
    [view.row, exchangeSources, recordsById]
  )
  const inspectable = view.row !== null
  const routingStopped = view.row !== null && routingState(routableNodeId(view.row), routing?.blocks).kind === 'stopped'
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
            {/* [mesh-citing-record-shots-four-defects] D3: the peer's other
               id spaces render as ALIASES on this one row -- signing key ·
               node · endpoint -- never as extra peer rows. */}
            {view.aliasLine ? <span className="font-mono text-fg-faint text-xs">{view.aliasLine}</span> : null}
            {/* UX §2: "self-reported" is true of every row, so it is said
               once in the legend under the table, not on each row. */}
            {view.identityNote ? <span className="text-fg-faint text-xs">{view.identityNote}</span> : null}
            {/* Visible while collapsed (chooser-v2 §3-F), but as the specific
               thing, counted, with one sentence on hover -- never a generic
               warning glyph (UX §8). */}
            {/* §7.5: a stopped peer says so on its row, as the fact -- the
               operator's own choice, only on this node. */}
            {routingStopped ? (
              <HoverChip census="peer:routing_stopped" label={ROUTING_STOPPED_TOOLTIP}>
                <span>
                  <StatusBadge size="caption" tone="muted">
                    {ROUTING_STOPPED_LABEL}
                  </StatusBadge>
                </span>
              </HoverChip>
            ) : null}
            {view.payments ? (
              <HoverChip census="peer:payments" label={PEER_PAYMENTS_TOOLTIP}>
                <span className="text-xs text-fg-dim" data-peer-payments="true">
                  Payments: {view.payments}
                </span>
              </HoverChip>
            ) : null}
            {view.attention.map((item) => (
              <HoverChip census={`peer_attention:${item.key}`} key={item.key} label={item.tooltip}>
                <span>
                  <StatusBadge size="caption" tone={item.tone}>
                    {item.label}
                  </StatusBadge>
                </span>
              </HoverChip>
            ))}
          </div>
        </TableCell>
        {visibleColumns.has('exchanges') ? (
          <TableCell className="text-xs text-fg-dim">{view.exchangeCount}</TableCell>
        ) : null}
        {visibleColumns.has('confirmed') ? (
          <TableCell className="text-xs text-fg-dim">{view.confirmedByOtherSide}</TableCell>
        ) : null}
        {visibleColumns.has('match') ? <TableCell className="text-xs text-fg-dim">{view.match}</TableCell> : null}
        {visibleColumns.has('adjudication') ? (
          <TableCell className="text-xs text-fg-dim">{view.adjudicationCompact}</TableCell>
        ) : null}
        {visibleColumns.has('witness') ? (
          <TableCell className="text-xs text-fg-dim">{view.witnessCompact}</TableCell>
        ) : null}
        {visibleColumns.has('period') ? <TableCell className="text-xs text-fg-dim">{view.period}</TableCell> : null}
      </TableRow>
      {view.row ? (
        <PeerInspector
          meshStatus={meshStatus}
          onClose={() => setInspectorOpen(false)}
          open={inspectorOpen}
          points={points}
          routing={routing}
          row={view.row}
        />
      ) : null}
    </>
  )
}
