import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataMode } from '@/lib/data-mode'
import { clearRouteTarget, fetchRouteTarget, setRouteTarget } from '@/features/capsules/api/routeTargetClient'

const ROUTE_TARGET_QUERY_KEY = ['ledger', 'route-target'] as const

export type RouteTargetControls = {
  /** The node this console's chats go to; `null` is automatic, `undefined`
   *  while unknown. */
  target: string | null | undefined
  chatWith: (nodeId: string) => Promise<void>
  clear: () => void
}

/** The host's console chat target. Harness mode has no host: automatic. */
export function useRouteTarget(): RouteTargetControls {
  const { mode } = useDataMode()
  const queryClient = useQueryClient()
  const key = [...ROUTE_TARGET_QUERY_KEY, mode]
  const query = useQuery({
    queryKey: key,
    queryFn: () => (mode === 'harness' ? Promise.resolve(null) : fetchRouteTarget()),
    retry: false
  })
  const settle = (target: string | null) => queryClient.setQueryData(key, target)
  const set = useMutation({ mutationFn: setRouteTarget, onSuccess: settle })
  const clear = useMutation({ mutationFn: clearRouteTarget, onSuccess: settle })
  return {
    target: query.data,
    chatWith: async (nodeId) => {
      await set.mutateAsync(nodeId)
    },
    clear: () => clear.mutate()
  }
}
