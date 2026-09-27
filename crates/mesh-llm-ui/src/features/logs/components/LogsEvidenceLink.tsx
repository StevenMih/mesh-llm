import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import { fetchPaneCList } from '@/features/capsules/api/sidecarClient'
import { evidenceRowKeyForLink } from '@/features/capsules/lib/chat-evidence-link'
import { LOGS_EVIDENCE_LINK_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'
import { useDataMode } from '@/lib/data-mode'
import { hrefWithBasePath } from '@/lib/env'

/** [mesh-chat-evidence-chip] A request with an exchange id links to that
 *  exchange's Evidence row -- shown only once a sealed record this node holds
 *  names the id and its row exists, so the tooltip's "sealed record" is true
 *  whenever the link is on screen. Reads the Evidence tab's own queries (same
 *  keys, same fetchers). A plain link (a page load), since the Logs table
 *  renders outside router context in its tests; the row itself still opens
 *  the inspector, so the click stops here. */
export function LogsEvidenceLink({ exchangeId }: { exchangeId: string }) {
  const { mode } = useDataMode()
  // Harness mode's Evidence data is built-in samples no real request is in.
  const enabled = mode !== 'harness'
  const ledger = useQuery({ queryKey: ['capsules', 'ledger'], queryFn: fetchCapsuleLedger, enabled })
  const paneC = useQuery({ queryKey: ['ledger', 'pane-c'], queryFn: () => fetchPaneCList(), retry: false, enabled })
  const rowKey =
    enabled && paneC.data && ledger.data
      ? evidenceRowKeyForLink(exchangeId, paneC.data.rows, ledger.data.records)
      : null
  if (!rowKey) return null

  return (
    <a
      aria-label={`Open exchange ${exchangeId} in Evidence`}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      data-testid="logs-row-evidence-link"
      href={hrefWithBasePath(`/capsules/exchange/${encodeURIComponent(rowKey)}`)}
      onClick={(event) => event.stopPropagation()}
      title={LOGS_EVIDENCE_LINK_TOOLTIP}
    >
      <ShieldCheck aria-hidden="true" className="size-3" />
      Evidence
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </a>
  )
}
