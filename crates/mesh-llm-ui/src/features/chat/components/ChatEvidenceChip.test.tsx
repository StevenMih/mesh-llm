import '@testing-library/jest-dom/vitest'

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { CapsulesExchangeRedirectPage } from '@/features/capsules/pages/CapsulesExchangeRedirectPage'
import { ChatEvidenceChip, type ChatEvidenceChipProps } from '@/features/chat/components/ChatEvidenceChip'
import { CHAT_EVIDENCE_CHIP_TOOLTIPS } from '@/features/capsules/lib/tooltip-copy'

vi.mock('@/features/capsules/api/sidecarClient', () => ({ fetchPaneCList: vi.fn() }))
vi.mock('@/features/capsules/api/client', () => ({ fetchCapsuleLedger: vi.fn() }))
const DIGEST = '1255a757d275bad8a4ed9346abed31961154ae239ad42e9cdf3d7b303a765feb'
const ROW_KEY = `digest:${DIGEST}`
const NONCE = '14af686f-86e5-4baa-bb6b-d3dd3c81cfec'

// The requester row and record as the freeze-candidate capture holds them.
const ASKED_ROW: PaneCRow = {
  exchange_key: ROW_KEY,
  role_tag: 'ASKED',
  counterparty: 'node:a70d3967bea3b22f',
  header_state: 'absent',
  properties: null,
  has_issue: false,
  mine: { state: 'present-unverified', capsule_id: 'a'.repeat(64), role: 'requested' },
  theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1790399191638' },
  unilateral: true,
  timestamp: '2026-09-26T05:06:31.706Z'
}
const REQUESTER_RECORD = {
  capsule_id: 'a'.repeat(64),
  effect: { request_digest: DIGEST },
  model_attestation: {
    compute_attestation: {
      'x-mesh-poc-v1': { client_nonce: NONCE }
    }
  }
}

function SearchProbe() {
  const search = useSearch({ from: '/capsules' })
  return <output aria-label="Evidence search">{JSON.stringify(search)}</output>
}

function renderChip(clientNonce: string) {
  const props: ChatEvidenceChipProps = { clientNonce, timestamp: new Date().toISOString() }
  const rootRoute = createRootRoute({ component: Outlet })
  const chatRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/chat',
    component: () => <ChatEvidenceChip {...props} />
  })
  const capsulesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/capsules',
    validateSearch: (search: Record<string, unknown>) =>
      typeof search['focusExchangeKey'] === 'string' ? { focusExchangeKey: search['focusExchangeKey'] } : {},
    component: SearchProbe
  })
  const exchangeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/capsules/exchange/$exchangeKey',
    component: CapsulesExchangeRedirectPage
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ['/chat'] }),
    routeTree: rootRoute.addChildren([chatRoute, capsulesRoute, exchangeRoute])
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

describe('ChatEvidenceChip', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    const { fetchCapsuleLedger } = await import('@/features/capsules/api/client')
    vi.mocked(fetchPaneCList).mockResolvedValue({
      rows: [ASKED_ROW],
      row_count: 1,
      default_sort: 'timestamp',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })
    vi.mocked(fetchCapsuleLedger).mockResolvedValue({ records: [REQUESTER_RECORD], nodePubKeyPem: null })
  })

  it('shows the row state under the message and opens that Evidence row', async () => {
    const router = renderChip(NONCE)

    const link = await screen.findByRole('link', { name: /sealed · their record not received yet/ })
    expect(link).toHaveAttribute('href', `/capsules/exchange/${encodeURIComponent(ROW_KEY)}`)
    // The chip carries its tooltip for the census, reachable without hovering.
    expect(link).toHaveAccessibleDescription(CHAT_EVIDENCE_CHIP_TOOLTIPS.awaiting)
    expect(link.closest('[data-census-chip]')).toHaveAttribute('data-census-chip', 'chat_evidence:awaiting')

    await userEvent.setup().click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe('/capsules'))
    expect(router.state.location.search).toEqual({ focusExchangeKey: ROW_KEY })
  })

  it('renders nothing when no sealed record carries the nonce, after both reads have landed', async () => {
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    const { fetchCapsuleLedger } = await import('@/features/capsules/api/client')
    renderChip('not-in-the-ledger')

    await waitFor(() => expect(vi.mocked(fetchPaneCList)).toHaveBeenCalled())
    await waitFor(() => expect(vi.mocked(fetchCapsuleLedger)).toHaveBeenCalled())
    await Promise.all([
      vi.mocked(fetchPaneCList).mock.results[0].value,
      vi.mocked(fetchCapsuleLedger).mock.results[0].value
    ])
    // Give the resolved data a render pass before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('chat-evidence-chip')).not.toBeInTheDocument()
  })

  it('the same component renders the chip for the matching nonce (control for the absence test)', async () => {
    renderChip(NONCE)
    expect(await screen.findByTestId('chat-evidence-chip')).toBeInTheDocument()
  })
})
