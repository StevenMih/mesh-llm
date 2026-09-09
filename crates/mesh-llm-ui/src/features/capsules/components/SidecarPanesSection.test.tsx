// Regression test for the "Save does nothing until reload" bug.
//
// Root cause: useSidecarBaseUrl() called twice (once in SidecarUrlField, once
// in SidecarPanesSection) each created an independent useState; the `storage`
// event never fires in the originating document, so the parent's state stayed
// null after a Save. Fix A (sidecarConfig.ts): module-level store over
// useSyncExternalStore — one shared snapshot, all instances update together.
//
// This test MUST fail against the pre-fix code (two useState instances) and
// MUST pass after the fix (module-level store).
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SidecarPanesSection } from '@/features/capsules/components/SidecarPanesSection'
import { _resetSidecarStoreForTest } from '@/features/capsules/api/sidecarConfig'

// ---------------------------------------------------------------------------
// Mock the sidecar pane fetchers and the ledger client — these would hit real
// network in a unit test. We just need to observe whether the pane SECTIONS
// render (which only happens when baseUrl != null in the parent).
// ---------------------------------------------------------------------------

vi.mock('@/features/capsules/api/sidecarClient', () => ({
  fetchPaneA: vi.fn().mockResolvedValue({ rows: [], operator: null, witness_checkpoint_supplied: false, card: null }),
  fetchPaneB: vi.fn().mockResolvedValue({ rows: [], peer_count: 0 }),
  fetchPaneCList: vi.fn().mockResolvedValue({ rows: [], row_count: 0, default_sort: '', filters: [], next_after_seq: null, archived_segments: [] })
}))

vi.mock('@/features/capsules/api/client', () => ({
  fetchCapsuleLedger: vi.fn().mockResolvedValue({ records: [], nodePubKeyPem: null })
}))

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return Wrapper
}

describe('SidecarPanesSection — Save wires panes without reload', () => {
  beforeEach(() => {
    // Reset module-level store between tests so each test starts fresh.
    _resetSidecarStoreForTest()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty-state line when no URL is configured', () => {
    render(<SidecarPanesSection />, { wrapper: makeWrapper() })

    expect(
      screen.getByText(/no sidecar url configured/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/my node \(sidecar\)/i)).not.toBeInTheDocument()
  })

  it('removes the empty-state line and shows pane sections immediately after Save — no reload required', async () => {
    // -----------------------------------------------------------------------
    // THIS IS THE REGRESSION: before the fix, the parent's useSidecarBaseUrl()
    // held a separate useState that never got notified in-document, so the
    // empty-state line remained even after Save wrote to localStorage.
    // After the fix (module-level store), the single shared snapshot updates
    // all hook instances in the same render cycle.
    // -----------------------------------------------------------------------
    const user = userEvent.setup()

    render(<SidecarPanesSection />, { wrapper: makeWrapper() })

    // Precondition: empty state visible, pane headings absent.
    expect(screen.getByText(/no sidecar url configured/i)).toBeInTheDocument()
    expect(screen.queryByText(/my node \(sidecar\)/i)).not.toBeInTheDocument()

    // Type a URL and click Save.
    const input = screen.getByRole('textbox', { name: /sidecar url/i })
    await user.clear(input)
    await user.type(input, 'http://127.0.0.1:8097')

    const saveButton = screen.getByRole('button', { name: /save/i })
    await user.click(saveButton)

    // After Save the module-level store notifies ALL subscribers, so the
    // parent's baseUrl becomes non-null in the same render cycle.
    // The empty-state line must be gone; the pane card headings must appear.
    expect(screen.queryByText(/no sidecar url configured/i)).not.toBeInTheDocument()
    expect(screen.getByText(/my node \(sidecar\)/i)).toBeInTheDocument()
    expect(screen.getByText(/peers \(sidecar\)/i)).toBeInTheDocument()
    expect(screen.getByText(/exchanges \(sidecar\)/i)).toBeInTheDocument()
  })

  it('hides pane sections and shows empty-state line immediately after Clear', async () => {
    // Seed a URL so we start with panes visible.
    window.localStorage.setItem('mesh-llm.accountability.sidecarBaseUrl', 'http://127.0.0.1:8097')
    _resetSidecarStoreForTest()
    // Re-read storage into the module store after seeding.
    // (In production the module-level _currentBaseUrl is initialised once at
    // module load; in tests we call _resetSidecarStoreForTest() which clears
    // it, so we need to set it manually here to simulate a pre-configured URL
    // at render time.)
    window.localStorage.setItem('mesh-llm.accountability.sidecarBaseUrl', 'http://127.0.0.1:8097')

    const user = userEvent.setup()

    // Re-import to pick up the seeded localStorage value; since modules are
    // cached we instead manipulate the store directly via the exported helper
    // and a re-render.
    //
    // Simpler approach: just use fireEvent to trigger Save from the field
    // after the component mounts with the seeded URL (the module store reads
    // localStorage on _subscribe first call, but since we cleared it above we
    // need to pre-configure). Seed directly and re-render.

    // Instead of fighting module cache, just render and Save first to get
    // panes showing, THEN click Clear and assert.
    render(<SidecarPanesSection />, { wrapper: makeWrapper() })

    const input = screen.getByRole('textbox', { name: /sidecar url/i })
    await user.clear(input)
    await user.type(input, 'http://127.0.0.1:8097')
    await user.click(screen.getByRole('button', { name: /save/i }))

    // Panes should now be visible.
    expect(screen.getByText(/my node \(sidecar\)/i)).toBeInTheDocument()

    // Clear.
    await user.click(screen.getByRole('button', { name: /clear/i }))

    // Empty state must be back immediately — no reload.
    expect(screen.getByText(/no sidecar url configured/i)).toBeInTheDocument()
    expect(screen.queryByText(/my node \(sidecar\)/i)).not.toBeInTheDocument()
  })
})
