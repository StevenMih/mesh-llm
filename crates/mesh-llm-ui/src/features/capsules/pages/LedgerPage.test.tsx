// Tests for LedgerPageContent — the three-section Ledger tab (Part 1 of
// [mesh-ledger-phase3-tables-and-modal]: Balance retired as a standalone
// tab, folded into a header strip on Exchanges).
//
// Test goals:
//   1. Three section tabs present (Peers/Exchanges/Integrity), Peers is the
//      default, with no configuration step required to see them populate
//   2. The premise line is rendered verbatim
//   3. No leaked internal IDs or tool names in the empty state, and no
//      sidecar URL box anywhere
//   4. Exchanges header shows two counts, never a ratio
//   5. The Balance header strip on Exchanges never crashes on an absent
//      served-summary and never fabricates a number
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

  it('shows three section tabs, Peers first and default', () => {
    render(<LedgerPageContent />, { wrapper: makeWrapper() })

    expect(screen.queryByRole('tab', { name: /balance/i })).not.toBeInTheDocument()
    const peersTab = screen.getByRole('tab', { name: /peers/i })
    expect(peersTab).toBeInTheDocument()
    expect(peersTab).toHaveAttribute('data-state', 'active')
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
    // Set up mock with 3 rows, 1 of which is bilateral (not unilateral).
    // `mockResolvedValue` (persistent, not `...Once`): Peers is now the
    // default/first-mounted tab and ALSO queries pane-c (for its own
    // exchange-timeline join, sharing this cache key by design) -- an
    // initial Peers mount consumes a one-time override before this test
    // ever switches to the Exchanges tab, and switching tabs mounts a new
    // pane-c observer that refetches (staleTime 0). A persistent value
    // matches real usage too: hitting the endpoint twice returns the same
    // data both times.
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneCList).mockResolvedValue({
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

  it('Exchanges shows the balance header strip above the records, honest absence when unwitnessed', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /exchanges/i }))

    // fetchPaneA's default mock (card: null) — never a crash, never a
    // fabricated number, an honest absence message instead. The coverage-
    // statement branches themselves (witnessed / not-reconciled / failed)
    // are unit-tested directly against the pure `balanceCoverage` function
    // in balance-view.test.ts — fetchPaneA is shared by three query sites
    // on this page, so asserting a specific override's exact caller here
    // would be an order-dependent test, not a real wiring check.
    expect(await screen.findByText('No served-summary data available yet.')).toBeInTheDocument()
  })
})

describe('LedgerPageContent — Part 3: Exchanges two-sided stream + row inspector', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders a two-sided row per exchange (CLOSED for an agreeing artifact, OPEN for a unilateral one), row opens the full-detail modal', async () => {
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneCList).mockResolvedValue({
      rows: [
        {
          exchange_key: 'exch-clean-00',
          role_tag: 'ASKED',
          header_state: 'ok',
          properties: {
            content_binding: { state: 'PASS' },
            checkpoint_signature: { state: 'PASS' },
            outcome_corroboration: { state: 'PASS' }
          },
          has_issue: false,
          mine: { state: 'present', capsule_id: 'mine-clean' },
          theirs: { state: 'present', capsule_id: 'theirs-clean' },
          unilateral: false,
          timestamp: '2026-09-08T16:58:05Z'
        },
        {
          exchange_key: 'exch-alarm-07',
          role_tag: 'ASKED',
          header_state: 'issue',
          properties: { checkpoint_signature: { state: 'FAIL', text: 'could not verify against the pinned key' } },
          has_issue: true,
          mine: { state: 'present', capsule_id: 'mine-alarm' },
          theirs: { state: 'absent', capsule_id: null },
          unilateral: true,
          timestamp: '2026-09-08T08:03:00Z'
        }
      ],
      row_count: 2,
      default_sort: '',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })

    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /exchanges/i }))

    // Both rows load — one CLOSED (agreeing artifact), one OPEN (never
    // asked, per L-C -- an absent theirs record with no evidence_outcome
    // carried can only honestly resolve to "not asked").
    expect(await screen.findByText('mine-clean')).toBeInTheDocument()
    expect(screen.getByText('mine-alarm')).toBeInTheDocument()
    expect(screen.getByText('CLOSED')).toBeInTheDocument()
    expect(screen.getByText('OPEN')).toBeInTheDocument()
    expect(screen.getByText('✓ cites your half by digest')).toBeInTheDocument()
    expect(screen.getByText("You haven't asked for their half.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ask them for their half' })).toBeInTheDocument()

    // Row click opens the full nine-property detail modal.
    await user.click(screen.getByLabelText('Open exchange inspector for exch-alarm-07'))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('exch-alarm-07')
    expect(dialog).toHaveTextContent('checkpoint signature: FAIL')
    expect(dialog).toHaveTextContent('content binding')
    expect(dialog).toHaveTextContent('producer signature')
  })

  it('Export view (CSV) and Save evidence file are two distinct, present toolbar actions', async () => {
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneCList).mockResolvedValue({
      rows: [
        {
          exchange_key: 'exch-1',
          role_tag: 'SERVED',
          header_state: 'ok',
          properties: null,
          has_issue: false,
          mine: { state: 'present', capsule_id: 'mine-1' },
          theirs: { state: 'present', capsule_id: 'theirs-1' },
          unilateral: false,
          timestamp: '2026-09-08T00:00:00Z'
        }
      ],
      row_count: 1,
      default_sort: '',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })

    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /exchanges/i }))
    await screen.findByText('exch-1')

    const exportButton = screen.getByRole('button', { name: /export view \(csv\)/i })
    const evidenceButton = screen.getByRole('button', { name: /save evidence file/i })
    expect(exportButton).toBeInTheDocument()
    expect(evidenceButton).toBeInTheDocument()
    expect(exportButton).not.toBe(evidenceButton)
  })
})

describe('LedgerPageContent — Part B1: Integrity chain strip', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('replaces both contradictory sentences with the chain strip + four first-person stat cards, a zero rendered prominently', async () => {
    const { fetchPaneA, fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    vi.mocked(fetchPaneA).mockResolvedValue({
      operator: null,
      witness_checkpoint_supplied: false,
      rows: [
        {
          capsule_id: 'c-1',
          timestamp: null,
          model_claimed: null,
          hardware_claimed: null,
          verify_ok: true,
          rungs: {},
          record: {}
        },
        {
          capsule_id: 'c-2',
          timestamp: null,
          model_claimed: null,
          hardware_claimed: null,
          verify_ok: true,
          rungs: {},
          record: {}
        }
      ],
      card: { checkpoint_count: null, continuity: 'unbroken', witnesses: [] }
    })
    vi.mocked(fetchPaneCList).mockResolvedValue({
      rows: [
        {
          exchange_key: 'exch-closed-1',
          role_tag: 'ASKED',
          header_state: 'ok',
          properties: { outcome_corroboration: { state: 'PASS' } },
          has_issue: false,
          mine: { state: 'present', capsule_id: 'mine-1' },
          theirs: { state: 'present', capsule_id: 'theirs-1' },
          unilateral: false,
          timestamp: null
        },
        {
          exchange_key: 'exch-contradicted-1',
          role_tag: 'ASKED',
          header_state: 'issue',
          properties: { outcome_corroboration: { state: 'FAIL', text: 'reported outcomes disagree' } },
          has_issue: true,
          mine: { state: 'present', capsule_id: 'mine-2' },
          theirs: { state: 'present', capsule_id: 'theirs-2' },
          unilateral: false,
          timestamp: null
        }
      ],
      row_count: 2,
      default_sort: '',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })

    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /integrity/i }))

    // The four first-person stat cards, with real (non-literal) counts.
    expect(await screen.findByText('Sealed')).toBeInTheDocument()
    expect(screen.getByText('Registered')).toBeInTheDocument()
    expect(screen.getByText('Closed by the other side')).toBeInTheDocument()
    expect(screen.getByText('Contradicted')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(0) // Sealed 2, Closed by the other side 2
    // A prominent, honest zero -- Registered 0 is present in the document,
    // not suppressed behind a muted "no data" fallback line.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1').length).toBeGreaterThan(0) // Contradicted 1 (chain strip's leading "1" also renders)

    // Both old contradictory sentences are gone.
    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/history is intact and registered with/i)
    expect(bodyText).not.toMatch(/no integrity fields available/i)
  })

  it('renders the chain strip + stat cards even with no data, never the old "no integrity fields" fallback', async () => {
    // Default mocked payloads: fetchPaneA returns rows:[], card:null and
    // fetchPaneCList returns rows:[] -- an honest all-zero render, not a
    // muted absence message.
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper: makeWrapper() })
    await user.click(screen.getByRole('tab', { name: /integrity/i }))

    expect(await screen.findByText('Sealed')).toBeInTheDocument()
    expect(screen.getByText('Registered')).toBeInTheDocument()
    expect(screen.getByText('Closed by the other side')).toBeInTheDocument()
    expect(screen.getByText('Contradicted')).toBeInTheDocument()

    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toMatch(/history is intact and registered with/i)
    expect(bodyText).not.toMatch(/no integrity fields available/i)
    expect(bodyText).not.toMatch(/no integrity data available/i)
  })
})
