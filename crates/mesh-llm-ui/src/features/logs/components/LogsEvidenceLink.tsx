import { ArrowUpRight, ShieldCheck } from 'lucide-react'
import { LOGS_EVIDENCE_LINK_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'
import { hrefWithBasePath } from '@/lib/env'

/** [mesh-chat-evidence-chip] A request with an exchange id links to that
 *  exchange's Evidence row; Evidence opens the row whose sealed record names
 *  the id, and opens nothing when none does. A plain link (a page load), since
 *  the Logs table renders outside router context in its tests; the row itself
 *  still opens the inspector, so the click stops here. */
export function LogsEvidenceLink({ exchangeId }: { exchangeId: string }) {
  return (
    <a
      aria-label={`Open exchange ${exchangeId} in Evidence`}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      data-testid="logs-row-evidence-link"
      href={hrefWithBasePath(`/capsules/exchange/${encodeURIComponent(exchangeId)}`)}
      onClick={(event) => event.stopPropagation()}
      title={LOGS_EVIDENCE_LINK_TOOLTIP}
    >
      <ShieldCheck aria-hidden="true" className="size-3" />
      Evidence
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </a>
  )
}
