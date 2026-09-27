// [mesh-evidence-hero-your-history-and-cleanup] Where the hero and the `Your
// records` panel get the owner's own facts. Live: the plugin's
// `evidence_records_status` tool. Without it (sample data, or a node whose
// plugin predates the tool) the one fact the hero can't do without -- is any
// prompt text stored here? -- is read off the same disclosure files the
// Exchanges rows already open, through the existing ledger route. Never a
// guess: past the probe limit with nothing found, it says "not shown".
import { useQuery } from '@tanstack/react-query'
import { fetchDisclosurePreimage } from '@/features/capsules/api/client'
import { fetchRecordsStatus, type RecordsStatus } from '@/features/capsules/api/recordsClient'

export const RECORDS_STATUS_QUERY_KEY = ['capsules', 'records-status'] as const

/** Records probed for stored text when there's no status tool to ask. */
export const STORED_TEXT_PROBE_LIMIT = 200

export type YourRecords = {
  status: RecordsStatus | null
  /** How many records have stored text; `null` when this view can't tell. */
  storedTextCount: number | null
}

export function storedTextFromProbe(found: number, probed: number, total: number): number | null {
  if (found > 0) return found
  return probed < total ? null : 0
}

export function useYourRecords({
  sample,
  capsuleIds
}: {
  sample: boolean
  /** `null` until the ledger has loaded: 0 of 0 probed is not "not kept". */
  capsuleIds: readonly string[] | null
}): YourRecords {
  const statusQuery = useQuery({
    queryKey: RECORDS_STATUS_QUERY_KEY,
    queryFn: fetchRecordsStatus,
    enabled: !sample,
    refetchInterval: 15_000,
    retry: false
  })
  const status = statusQuery.data ?? null
  const needProbe = status === null && capsuleIds !== null && (sample || statusQuery.isError)
  const probeIds = needProbe ? capsuleIds.slice(0, STORED_TEXT_PROBE_LIMIT) : []
  const probeQuery = useQuery({
    queryKey: ['capsules', 'stored-text-probe', probeIds],
    queryFn: async () => (await Promise.all(probeIds.map((id) => fetchDisclosurePreimage(id)))).filter(Boolean).length,
    enabled: needProbe,
    staleTime: 60_000
  })

  if (status) return { status, storedTextCount: status.stored_text_count }
  if (needProbe && probeQuery.data !== undefined) {
    return {
      status: null,
      storedTextCount: storedTextFromProbe(probeQuery.data, probeIds.length, capsuleIds?.length ?? 0)
    }
  }
  return { status: null, storedTextCount: null }
}
