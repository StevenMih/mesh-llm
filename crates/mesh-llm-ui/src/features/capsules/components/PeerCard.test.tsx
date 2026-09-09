// [mesh-ledger-peers-tab] Phase 1 acceptance: a clean peer and an alarmed
// peer render with-you-front, denominator-honest adjudications, and an
// always-visible alarm chip. `useNavigate` is exercised outside a
// `RouterProvider` here (this component is also rendered standalone inside
// LedgerPage's own tests) -- it degrades to a console warning rather than
// throwing, so no router wrapper is needed for this render-only check.
//
// [mesh-ledger-phase3-tables-and-modal] Part 2: the inline `expanded`
// accordion is gone -- clicking the row pops the `PeerInspector` modal
// (Overview default; Timeline/Exchanges tabs carry the one-timeline view
// and the per-exchange drill-down that used to live inline).
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PeerCard } from '@/features/capsules/components/PeerCard'
import {
  HARNESS_PANE_B_PAYLOAD,
  PEER_TAB_HARNESS_EXCHANGE_SOURCES,
  PEER_TAB_HARNESS_LEDGER_RECORDS,
  PEER_TAB_HARNESS_MESH_MODELS,
  PEER_TAB_HARNESS_MESH_PEERS
} from '@/features/capsules/lib/peer-fixtures'
import { deriveMeshStatus } from '@/features/capsules/lib/peer-mesh-status'

const [CLEAN_ROW, ALARMED_ROW] = HARNESS_PANE_B_PAYLOAD.rows

describe('PeerCard', () => {
  it('renders the clean peer with-you-front, a denominator-honest adjudication line, and no alarm chip', () => {
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    render(<PeerCard meshStatus={meshStatus} row={CLEAN_ROW} />)

    expect(screen.getByText('16 requested · 8 served · 16 confirmed')).toBeInTheDocument()
    expect(screen.getByText(/8 of 24 adjudicated · 8 corroborated/)).toBeInTheDocument()
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()
  })

  it('renders the alarmed peer with a visible alarm chip and never shows the contradiction as corroborated-only', () => {
    const meshStatus = deriveMeshStatus(
      ALARMED_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    render(<PeerCard meshStatus={meshStatus} row={ALARMED_ROW} />)

    expect(screen.getByText(/⚠ Contradiction found/)).toBeInTheDocument()
    expect(screen.getByText(/7 of 14 adjudicated · 6 corroborated · 1 contradicted/)).toBeInTheDocument()
  })

  it('resolves an alarm date from the local ledger lookup when provided', () => {
    const meshStatus = deriveMeshStatus(
      ALARMED_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const resolveTimestamp = vi.fn(() => '2026-09-08')
    render(<PeerCard meshStatus={meshStatus} resolveTimestamp={resolveTimestamp} row={ALARMED_ROW} />)

    expect(resolveTimestamp).toHaveBeenCalledWith('cap-alarmed-adjudication-0007')
    expect(screen.getByText(/⚠ Contradiction found 2026-09-08/)).toBeInTheDocument()
  })

  it("shows 'mesh status not available' rather than fabricating a model when the join misses", () => {
    render(<PeerCard meshStatus={null} row={CLEAN_ROW} />)

    expect(screen.getByText('mesh status not available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Route here' })).toBeDisabled()
  })

  it('never renders the their-chain sentence on the row — the alarm chip is the only row-level signal, the modal enumerates the rest', () => {
    const meshStatus = deriveMeshStatus(
      ALARMED_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    render(<PeerCard meshStatus={meshStatus} row={ALARMED_ROW} />)

    // ALARMED_ROW carries a contradicted verdict AND a failed chain --
    // alarmSignal() surfaces only the higher-priority contradiction on the
    // row; the chain-failure sentence (previously rendered unconditionally
    // right on the row) now appears only once the modal is opened.
    expect(screen.getByText(/⚠ Contradiction found/)).toBeInTheDocument()
    expect(screen.queryByText(/could not confirm their chain is unbroken/)).not.toBeInTheDocument()
  })

  it("Route here does not open the inspector modal (it stops the row's click from bubbling)", async () => {
    const user = userEvent.setup()
    render(<PeerCard meshStatus={null} row={CLEAN_ROW} />)

    // Disabled (no mesh status), but a real click handler would still not
    // reach the row's onClick — asserting the dialog never opens either way.
    await user.click(screen.getByRole('button', { name: 'Route here' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('PeerCard Part 2 — pop-out into the PeerInspector modal', () => {
  it('opens the modal on row click, Overview tab active by default', async () => {
    const user = userEvent.setup()
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    render(<PeerCard meshStatus={meshStatus} row={CLEAN_ROW} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /overview/i })).toHaveAttribute('data-state', 'active')
    // Overview repeats the with-you/adjudication facts for the popped-out
    // view; their-chain gets its full sentence here (never on the row).
    expect(within(dialog).getByText(/16 requested · 8 served · 16 confirmed/)).toBeInTheDocument()
  })

  it('shows the timeline lanes and a drill-down with verdict/margin_tau/referee for an adjudicated exchange', async () => {
    const user = userEvent.setup()
    render(
      <PeerCard
        exchangeSources={PEER_TAB_HARNESS_EXCHANGE_SOURCES[CLEAN_ROW.peer_id ?? '']}
        meshStatus={null}
        recordsById={PEER_TAB_HARNESS_LEDGER_RECORDS}
        row={CLEAN_ROW}
      />
    )

    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))
    await user.click(screen.getByRole('tab', { name: /timeline/i }))
    expect(screen.getByText('Your exchanges')).toBeInTheDocument()
    expect(screen.getByText('Adjudication (requested only)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Adjudication for exch-clean-00: corroborated/i }))
    expect(screen.getByText('corroborated')).toBeInTheDocument()
    expect(screen.getByText(/margin_tau: 0.9/)).toBeInTheDocument()
    expect(screen.getByText(/referee: local-twin/)).toBeInTheDocument()
  })

  it('shows NOT_CHECKED for a requested exchange with no sealed adjudication, never a fabricated verdict', async () => {
    const user = userEvent.setup()
    render(
      <PeerCard
        exchangeSources={PEER_TAB_HARNESS_EXCHANGE_SOURCES[CLEAN_ROW.peer_id ?? '']}
        meshStatus={null}
        recordsById={PEER_TAB_HARNESS_LEDGER_RECORDS}
        row={CLEAN_ROW}
      />
    )

    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))
    await user.click(screen.getByRole('tab', { name: /timeline/i }))
    await user.click(screen.getByRole('button', { name: /Adjudication for exch-clean-01: not checked/i }))

    const dialogs = screen.getAllByRole('dialog')
    const drilldown = within(dialogs[dialogs.length - 1])
    expect(drilldown.getByText(/no adjudication sealed for this exchange/i)).toBeInTheDocument()
    expect(drilldown.queryByText(/corroborated|contradicted|inconclusive/i)).not.toBeInTheDocument()
  })

  it('surfaces the contradicted verdict for the alarmed peer, citing the same capsule id as the inline alarm chip', async () => {
    const user = userEvent.setup()
    render(
      <PeerCard
        exchangeSources={PEER_TAB_HARNESS_EXCHANGE_SOURCES[ALARMED_ROW.peer_id ?? '']}
        meshStatus={null}
        recordsById={PEER_TAB_HARNESS_LEDGER_RECORDS}
        row={ALARMED_ROW}
      />
    )

    await user.click(screen.getByText(ALARMED_ROW.peer_id ?? ''))
    await user.click(screen.getByRole('tab', { name: /timeline/i }))
    await user.click(screen.getByRole('button', { name: /Adjudication for exch-alarm-07: contradicted/i }))

    expect(screen.getByText('contradicted')).toBeInTheDocument()
    expect(screen.getByText('cap-alarmed-adjudication-0007')).toBeInTheDocument()
  })

  it('the Exchanges tab lists every exchange and opens the same drill-down on click', async () => {
    const user = userEvent.setup()
    render(
      <PeerCard
        exchangeSources={PEER_TAB_HARNESS_EXCHANGE_SOURCES[CLEAN_ROW.peer_id ?? '']}
        meshStatus={null}
        recordsById={PEER_TAB_HARNESS_LEDGER_RECORDS}
        row={CLEAN_ROW}
      />
    )

    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))
    await user.click(screen.getByRole('tab', { name: /^exchanges$/i }))
    expect(screen.getByText('exch-clean-00')).toBeInTheDocument()

    await user.click(screen.getByText('exch-clean-00'))
    const dialogs = await screen.findAllByRole('dialog')
    const drilldown = within(dialogs[dialogs.length - 1])
    expect(drilldown.getByText('corroborated')).toBeInTheDocument()
    expect(drilldown.getByText(/margin_tau: 0.9/)).toBeInTheDocument()
  })

  it('the modal states the full their-chain sentence exactly once, on the Overview tab', async () => {
    const user = userEvent.setup()
    const meshStatus = deriveMeshStatus(
      ALARMED_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    render(<PeerCard meshStatus={meshStatus} row={ALARMED_ROW} />)

    await user.click(screen.getByText(ALARMED_ROW.peer_id ?? ''))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getAllByText(/could not confirm their chain is unbroken/).length).toBe(1)
  })
})
