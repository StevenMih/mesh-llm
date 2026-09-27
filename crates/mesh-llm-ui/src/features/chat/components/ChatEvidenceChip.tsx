// [mesh-chat-evidence-chip] UX review rev 2 §7.6 (1): under an assistant
// message, a chip that says whether this turn is sealed and what the other
// side's record says, linking to that exchange's Evidence row. Renders nothing
// when no sealed record of this turn is found -- never a guess.
//
// Reads the queries the Evidence tab reads (same keys, same fetchers) and the
// tab's one gate; see `chatEvidenceChip` for where the two can differ.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import { fetchPaneCList } from '@/features/capsules/api/sidecarClient'
import { HoverChip } from '@/features/capsules/components/HoverChip'
import type { PaneCListJson } from '@/features/capsules/api/sidecarTypes'
import { chatEvidenceChipForTurn, chatEvidencePollMs } from '@/features/capsules/lib/chat-evidence-link'
import { useDataMode } from '@/lib/data-mode'
import { cn } from '@/lib/cn'

export type ChatEvidenceChipProps = {
  /** The `x-capsule-client-nonce` the turn's response carried. */
  clientNonce: string
  /** When the turn happened; polling stops once it is this old. */
  timestamp: string
}

// The Evidence tab's own keys, so both read one cache entry.
const LEDGER_KEY = ['capsules', 'ledger']
const PANE_C_KEY = ['ledger', 'pane-c']

export function ChatEvidenceChip({ clientNonce, timestamp }: ChatEvidenceChipProps) {
  const { mode } = useDataMode()
  // Harness mode renders the Evidence tab from built-in sample data, which no
  // real Chat turn can belong to.
  const enabled = mode !== 'harness'

  // Both queries re-read on the chip's schedule (`chatEvidencePollMs`): only
  // while something can still arrive, and never past the row's own wait.
  // A turn this node served itself seals no nonce, so it only reaches the cutoff.
  const queryClient = useQueryClient()
  const cachedRows = () => queryClient.getQueryData<PaneCListJson>(PANE_C_KEY)?.rows ?? []
  const ledger = useQuery({
    queryKey: LEDGER_KEY,
    queryFn: fetchCapsuleLedger,
    refetchInterval: (query) =>
      chatEvidencePollMs(
        chatEvidenceChipForTurn(clientNonce, cachedRows(), query.state.data?.records ?? []),
        timestamp,
        Date.now()
      ),
    enabled
  })
  const records = ledger.data?.records ?? []
  const paneC = useQuery({
    queryKey: PANE_C_KEY,
    queryFn: () => fetchPaneCList(),
    refetchInterval: (query) =>
      chatEvidencePollMs(
        chatEvidenceChipForTurn(clientNonce, query.state.data?.rows ?? [], records),
        timestamp,
        Date.now()
      ),
    retry: false,
    enabled
  })
  const found = enabled ? chatEvidenceChipForTurn(clientNonce, paneC.data?.rows ?? [], records) : null
  if (!found) return null
  const { rowKey, chip } = found

  return (
    <TooltipProvider delayDuration={250} skipDelayDuration={120}>
      <div className="mt-1.5 px-4" data-testid="chat-evidence-chip">
        <HoverChip census={`chat_evidence:${chip.kind}`} label={chip.tooltip}>
          <Link
            aria-label={`${chip.label}. Open this exchange in Evidence`}
            className={cn(
              'inline-flex items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5 font-mono text-[length:var(--density-type-caption)] outline-none transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
              chip.kind === 'differs' ? 'border-bad/40 text-bad' : 'border-border text-fg-dim'
            )}
            data-chip-kind={chip.kind}
            params={{ exchangeKey: rowKey }}
            to="/capsules/exchange/$exchangeKey"
          >
            <ShieldCheck aria-hidden="true" className="size-3" />
            {chip.label}
          </Link>
        </HoverChip>
      </div>
    </TooltipProvider>
  )
}
