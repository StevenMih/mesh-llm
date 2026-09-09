// [mesh-ledger-peers-tab] Phase 1 acceptance: a clean peer and an alarmed
// peer render with-you-front, denominator-honest adjudications, and an
// always-visible alarm chip. `useNavigate` is exercised outside a
// `RouterProvider` here (this component is also rendered standalone inside
// LedgerPage's own tests) -- it degrades to a console warning rather than
// throwing, so no router wrapper is needed for this render-only check.
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
})

describe('PeerCard Phase 2 — expand into the timeline and drill down', () => {
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

    await user.click(screen.getByRole('button', { name: /expand/i }))
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

    await user.click(screen.getByRole('button', { name: /expand/i }))
    await user.click(screen.getByRole('button', { name: /Adjudication for exch-clean-01: not checked/i }))

    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/no adjudication sealed for this exchange/i)).toBeInTheDocument()
    expect(dialog.queryByText(/corroborated|contradicted|inconclusive/i)).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: /expand/i }))
    await user.click(screen.getByRole('button', { name: /Adjudication for exch-alarm-07: contradicted/i }))

    expect(screen.getByText('contradicted')).toBeInTheDocument()
    expect(screen.getByText('cap-alarmed-adjudication-0007')).toBeInTheDocument()
  })
})
