// [mesh-ledger-peers-tab] Phase 1 acceptance: a clean peer and an alarmed
// peer render with-you-front, denominator-honest adjudications, and an
// always-visible alarm chip. `useNavigate` is exercised outside a
// `RouterProvider` here (this component is also rendered standalone inside
// LedgerPage's own tests) -- it degrades to a console warning rather than
// throwing, so no router wrapper is needed for this render-only check.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PeerCard } from '@/features/capsules/components/PeerCard'
import {
  HARNESS_PANE_B_PAYLOAD,
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
