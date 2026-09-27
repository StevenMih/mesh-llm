// §7.5 the `Stop routing to this peer` dialog: three facts, then the two
// lengths. Not a destructive action (it is undoable), so neutral buttons.
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { cn } from '@/lib/cn'
import type { BlockLength } from '@/features/capsules/api/peerBlocksClient'
import { ROUTING_BLOCK_COPY } from '@/features/capsules/lib/tooltip-copy'

export type StopRoutingDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The full node id the block is keyed by, shown whole. */
  nodeId: string
  onBlock: (length: BlockLength) => void
  /** Why the block buttons are off (sample data), or null when they work. */
  disabledReason: string | null
}

const BUTTON =
  'ui-control inline-flex h-8 items-center justify-center rounded-[var(--radius)] border px-3.5 text-[length:var(--density-type-control)] font-medium leading-none outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50'

export function StopRoutingDialog({ open, onOpenChange, nodeId, onBlock, disabledReason }: StopRoutingDialogProps) {
  const disabled = disabledReason !== null
  return (
    <AlertDialogPrimitive.Root onOpenChange={onOpenChange} open={open}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className="surface-scrim fixed inset-0 z-50" />
        <AlertDialogPrimitive.Content className="shadow-surface-modal fixed left-1/2 top-1/2 z-50 w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-panel text-foreground outline-none">
          <div className="px-5 pb-4 pt-4.5">
            <AlertDialogPrimitive.Title className="text-[length:var(--density-type-headline)] font-semibold leading-5 text-fg">
              {ROUTING_BLOCK_COPY.dialogTitle}
            </AlertDialogPrimitive.Title>
            <p className="mt-1 font-mono text-xs break-all text-fg-faint">node {nodeId}</p>
            <AlertDialogPrimitive.Description asChild>
              <div className="mt-3 text-[length:var(--density-type-control)] leading-[1.5] text-fg-dim">
                <ul className="flex flex-col gap-1">
                  {ROUTING_BLOCK_COPY.dialogLines.map((line) => (
                    <li className="text-foreground" key={line}>
                      {line}
                    </li>
                  ))}
                </ul>
                <p className="mt-3">{ROUTING_BLOCK_COPY.dialogDetail}</p>
                {disabledReason ? <p className="mt-2 text-fg-faint">{disabledReason}</p> : null}
              </div>
            </AlertDialogPrimitive.Description>
          </div>
          <div className="flex flex-col-reverse gap-2.5 border-t border-border-soft bg-panel-strong/70 px-5 py-3 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Cancel className={cn(BUTTON, 'min-w-[88px]')}>Cancel</AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action
              className={cn(BUTTON, 'text-foreground')}
              disabled={disabled}
              onClick={() => onBlock('seven_days')}
            >
              {ROUTING_BLOCK_COPY.blockSevenDays}
            </AlertDialogPrimitive.Action>
            <AlertDialogPrimitive.Action
              className={cn(BUTTON, 'text-foreground')}
              disabled={disabled}
              onClick={() => onBlock('until_undone')}
            >
              {ROUTING_BLOCK_COPY.blockUntilUndone}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
