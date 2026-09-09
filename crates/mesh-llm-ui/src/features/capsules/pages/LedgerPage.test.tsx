// Tests for LedgerPageContent — the four-section Ledger tab (L2 build).
//
// Test goals:
//   1. Four section tabs present (Balance/Peers/Exchanges/Integrity)
//   2. The premise line is rendered verbatim
//   3. No leaked internal IDs or tool names in the empty state (no sidecar URL)
//   4. Exchanges header shows two counts, never a ratio
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LedgerPageContent } from '@/features/capsules/pages/LedgerPage'
import { _resetSidecarStoreForTest } from '@/features/capsules/api/sidecarConfig'

// ---------------------------------------------------------------------------
// Mock all network fetchers — tests must never hit the real network.
// ---------------------------------------------------------------------------

vi.mock('@/features/capsules/api/sidecarClient', () => ({
  fetchPaneA: vi.fn().mockResolvedValue({
    rows: [],
    operator: null,
    witness_checkpoint_supplied: false,
    card: null
  }),
  fetchPaneB: vi.fn().mockResolvedValue({ rows: [], peer_count: 0 }),
  fetchPaneCList: vi.fn().mockResolvedValue({
    rows: [],
    row_count: 0,
    default_sort: '',
    filters: [],
    next_after_seq: null,
    archived_segments: []
  })
}))

vi.mock('@/features/capsules/api/client', () => ({
  fetchCapsuleLedger: vi.fn().mockResolvedValue({ records: [], nodePubKeyPem: null })
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return Wrapper
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LedgerPageContent', () => {
  beforeEach(() => {
    _resetSidecarStoreForTest()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows four section tabs', () => {
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    expect(screen.getByRole('tab', { name: /balance/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /peers/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /exchanges/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /integrity/i })).toBeInTheDocument()
  })

  it('shows the premise line', () => {
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    expect(
      screen.getByText('Everything here is recomputed from sealed records. All values are structural facts, not assessments.')
    ).toBeInTheDocument()
  })

  it('shows no leaked IDs in empty state', () => {
    // No sidecar URL set — every section should show an honest absent state,
    // with none of the forbidden internal strings.
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/\[mesh-/)
    expect(bodyText).not.toMatch(/self_accountability\.py/)
    expect(bodyText).not.toMatch(/not built yet/i)
  })

  it('Exchanges header shows two counts not a ratio', async () => {
    // Set up mock with 3 rows, 1 of which is bilateral (not unilateral)
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneCList).mockResolvedValueOnce({
      rows: [
        {
          exchange_key: 'exc-1',
          role_tag: 'initiator',
          header_state: 'ok',
          properties: null,
          has_issue: false,
          mine: { state: 'present', capsule_id: null },
          theirs: { state: 'present', capsule_id: null },
          unilateral: false,
          timestamp: null
        },
        {
          exchange_key: 'exc-2',
          role_tag: 'responder',
          header_state: 'ok',
          properties: null,
          has_issue: false,
          mine: { state: 'present', capsule_id: null },
          theirs: { state: 'absent', capsule_id: null },
          unilateral: true,
          timestamp: null
        },
        {
          exchange_key: 'exc-3',
          role_tag: 'responder',
          header_state: 'ok',
          properties: null,
          has_issue: false,
          mine: { state: 'present', capsule_id: null },
          theirs: { state: 'absent', capsule_id: null },
          unilateral: true,
          timestamp: null
        }
      ],
      row_count: 3,
      default_sort: '',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })

    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    // Configure a sidecar URL so sections become active
    const input = screen.getByRole('textbox', { name: /sidecar url/i })
    await user.clear(input)
    await user.type(input, 'http://127.0.0.1:8765')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Navigate to Exchanges tab
    await user.click(screen.getByRole('tab', { name: /exchanges/i }))

    // Wait for data
    const headerEl = await screen.findByText(/3 exchange/i)
    expect(headerEl.textContent).toMatch(/3 exchange/)
    expect(headerEl.textContent).toMatch(/1 confirmed by the other side/)

    // Ratios and percentages must NOT appear
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/1\/3/)
    expect(bodyText).not.toMatch(/33%/)
  })
})
