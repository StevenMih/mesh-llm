import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDataMode } from '@/lib/data-mode'
import { blockPeer, fetchPeerBlocks, unblockPeer, type BlockLength } from '@/features/capsules/api/peerBlocksClient'
import type { PeerBlocksJson } from '@/features/capsules/lib/peer-routing-view'
import type { RouteTargetControls } from '@/features/capsules/api/useRouteTarget'

const NO_BLOCKS: PeerBlocksJson = { blocks: {}, choices: [] }

const PEER_BLOCKS_QUERY_KEY = ['ledger', 'peer-blocks'] as const

/** What the Peers table and the drill need to show and change local blocks. */
export type PeerRoutingControls = {
  /** `undefined` while loading or when the host has no block store to read. */
  blocks: PeerBlocksJson | undefined
  block: (peer: string, length: BlockLength) => void
  unblock: (peer: string) => void
  /** The peer whose last block or unblock failed, until the next attempt. */
  failedFor: string | null
  /** Where this console's chats go (u115 "Chat with this node"). */
  chat?: RouteTargetControls
}

/** The host's local block store. Harness mode has no host, so no blocks. */
export function usePeerRoutingControls(): PeerRoutingControls {
  const { mode } = useDataMode()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: [...PEER_BLOCKS_QUERY_KEY, mode],
    queryFn: () => (mode === 'harness' ? Promise.resolve(NO_BLOCKS) : fetchPeerBlocks()),
    refetchInterval: 15_000,
    retry: false
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: PEER_BLOCKS_QUERY_KEY })
  const [failedFor, setFailedFor] = useState<string | null>(null)
  const block = useMutation({
    mutationFn: ({ peer, length }: { peer: string; length: BlockLength }) => blockPeer(peer, length),
    onMutate: () => setFailedFor(null),
    onError: (_error, { peer }) => setFailedFor(peer),
    onSettled: refresh
  })
  const unblock = useMutation({
    mutationFn: (peer: string) => unblockPeer(peer),
    onMutate: () => setFailedFor(null),
    onError: (_error, peer) => setFailedFor(peer),
    onSettled: refresh
  })
  return {
    blocks: query.data,
    block: (peer, length) => block.mutate({ peer, length }),
    unblock: (peer) => unblock.mutate(peer),
    failedFor
  }
}
