// §7.5: the bottom of the peer drill. Whether this node routes to the peer,
// the action to stop or resume, and whether that choice is on your records.
// The block is local: the host's router skips the peer, nobody is told.
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import type { PeerRoutingControls } from '@/features/capsules/api/usePeerBlocks'
import { ChatWithNodeButton } from '@/features/capsules/components/ChatWithNodeButton'
import { StopRoutingDialog } from '@/features/capsules/components/StopRoutingDialog'
import { recordText, routableNodeId, routingState, routingStateText } from '@/features/capsules/lib/peer-routing-view'
import { ROUTING_BLOCK_COPY, SAMPLE_DATA_UNAVAILABLE } from '@/features/capsules/lib/tooltip-copy'

export type PeerRoutingSectionProps = {
  row: PaneBRow
  routing: PeerRoutingControls
  /** True when the tab is replaying saved sample data: nothing can change.
   *  Defaults to whether the dev server is replaying a fixture run. */
  sampleData?: boolean
}

export function PeerRoutingSection({
  row,
  routing,
  sampleData = Boolean(import.meta.env.VITE_EVIDENCE_FIXTURES)
}: PeerRoutingSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const nodeId = routableNodeId(row)
  const state = routingState(nodeId, routing.blocks)
  const record = state.kind === 'no_node_id' ? null : recordText(state.last)

  return (
    <section
      aria-label={ROUTING_BLOCK_COPY.sectionTitle}
      className="flex flex-col gap-2 border-t border-border-soft pt-3"
    >
      <h3 className="text-xs font-medium text-foreground">{ROUTING_BLOCK_COPY.sectionTitle}</h3>
      <p>{routingStateText(state)}</p>
      {record ? <p className="text-xs text-fg-faint">{record}</p> : null}
      {nodeId !== null && routing.failedFor === nodeId ? (
        <p className="text-xs text-fg-faint">{ROUTING_BLOCK_COPY.failed}</p>
      ) : null}
      {nodeId !== null && state.kind === 'routing' && routing.chat && !sampleData ? (
        <div>
          <ChatWithNodeButton controls={routing.chat} nodeId={nodeId} />
        </div>
      ) : null}
      {nodeId !== null && state.kind === 'routing' ? (
        <div>
          <Button onClick={() => setDialogOpen(true)} size="sm" type="button" variant="outline">
            {ROUTING_BLOCK_COPY.stopAction}
          </Button>
          <StopRoutingDialog
            disabledReason={sampleData ? SAMPLE_DATA_UNAVAILABLE : null}
            onBlock={(length) => routing.block(nodeId, length)}
            onOpenChange={setDialogOpen}
            open={dialogOpen}
            nodeId={nodeId}
          />
        </div>
      ) : null}
      {nodeId !== null && state.kind === 'stopped' ? (
        <div>
          <Button
            disabled={sampleData}
            onClick={() => routing.unblock(nodeId)}
            size="sm"
            type="button"
            variant="outline"
          >
            {ROUTING_BLOCK_COPY.resumeAction}
          </Button>
          {sampleData ? <p className="mt-1 text-xs text-fg-faint">{SAMPLE_DATA_UNAVAILABLE}</p> : null}
        </div>
      ) : null}
    </section>
  )
}
