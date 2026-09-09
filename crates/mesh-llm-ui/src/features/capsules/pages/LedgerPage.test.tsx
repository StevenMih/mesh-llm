// Tests for LedgerPageContent — the four-section Ledger tab (L2 build,
// [mesh-ledger-earned-pass-and-native-panes] Part B native-panes rebuild).
//
// Test goals:
//   1. Four section tabs present (Balance/Peers/Exchanges/Integrity), with no
//      configuration step required to see them populate
//   2. The premise line is rendered verbatim
//   3. No leaked internal IDs or tool names in the empty state, and no
//      sidecar URL box anywhere
//   4. Exchanges header shows two counts, never a ratio
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LedgerPageContent } from '@/features/capsules/pages/LedgerPage'

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
      screen.getByText('Everything here is recomputed from sealed records. Nothing is a score.')
    ).toBeInTheDocument()
  })

  it('shows no leaked IDs in empty state', () => {
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/\[mesh-/)
    expect(bodyText).not.toMatch(/self_accountability\.py/)
    expect(bodyText).not.toMatch(/not built yet/i)
  })

  it('never renders a sidecar URL box — sections are native, no configuration step', () => {
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    expect(screen.queryByRole('textbox', { name: /sidecar url/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/sidecar url/i)
    expect(bodyText).not.toMatch(/configure a sidecar/i)
    expect(bodyText).not.toMatch(/set the url/i)
    expect(bodyText).not.toMatch(/localhost:8089|127\.0\.0\.1:8089/)
  })

  it('populates a section immediately with no prior configuration', async () => {
    const { fetchPaneB } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneB).mockResolvedValueOnce({
      rows: [
        {
          peer_id: 'peer-1',
          node: { state: 'present', text: 'peer-1', peer_id: 'peer-1', member_kind: 'member', exchange_count: 1 },
          rung: {
            state: 'present',
            text: 'full_bilateral',
            rung: 'full_bilateral',
            distinct_rungs: ['full_bilateral']
          },
          role: {
            state: 'present',
            text: 'you_to_them · 1',
            role: 'you_to_them',
            you_to_them_count: 1,
            them_to_you_count: 0,
            exchange_count: 1
          },
          history: { state: 'NOT_CHECKED', text: null },
          served: { state: 'NOT_CHECKED', text: null },
          pair: { state: 'absent', text: null, verified: 0, failed: 0, missing: 0, details: [] },
          verdicts: { state: 'NOT_CHECKED', text: null, tally: { corroborated: 0, contradicted: 0, inconclusive: 0 } },
          asked: { state: 'absent', text: null, count: 0 },
          exchange_count: 1,
          first_seen: null,
          last_seen: null
        }
      ],
      peer_count: 1
    })

    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /peers/i }))

    expect(await screen.findByText('peer-1')).toBeInTheDocument()
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
