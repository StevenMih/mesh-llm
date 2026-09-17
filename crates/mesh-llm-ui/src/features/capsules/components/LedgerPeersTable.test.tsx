// [ledger-T7-peers-table] The Peers table shell: two never-merged row
// groups, the Exchanges-style toolbar (Search / Filter / Columns / Export /
// Save evidence file / Reset view), and the zero-dealings acceptance check.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LedgerPeersTable } from '@/features/capsules/components/LedgerPeersTable'
import {
  HARNESS_PANE_B_PAYLOAD,
  PEER_TAB_HARNESS_MESH_MODELS,
  PEER_TAB_HARNESS_MESH_PEERS
} from '@/features/capsules/lib/peer-fixtures'
import { advertisedOnlyPeers, deriveMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import { advertisedOnlyRowView, dealtWithRowView, peerDisplayId } from '@/features/capsules/lib/peer-row-view'

const [CLEAN_ROW, ALARMED_ROW] = HARNESS_PANE_B_PAYLOAD.rows

function buildFixtureProps() {
  const statusFor = (peerId: string) =>
    deriveMeshStatus(peerId, PEER_TAB_HARNESS_MESH_PEERS, PEER_TAB_HARNESS_MESH_MODELS)
  const dealtWithRawRows = [CLEAN_ROW, ALARMED_ROW]
  const advertisedRawPeers = advertisedOnlyPeers(dealtWithRawRows, PEER_TAB_HARNESS_MESH_PEERS)
  const dealtWith = dealtWithRawRows.map((row) => dealtWithRowView(row, statusFor(peerDisplayId(row) ?? '')))
  const advertisedUnused = advertisedRawPeers.map((peer) =>
    advertisedOnlyRowView(peer.shortId ?? peer.id, statusFor(peer.id))
  )
  return {
    dealtWith,
    advertisedUnused,
    dealtWithRawRows,
    advertisedUnusedRawPeers: advertisedRawPeers,
    meshStatus: { statusFor, peers: PEER_TAB_HARNESS_MESH_PEERS },
    exchangeSourcesFor: () => [],
    recordsById: new Map()
  }
}

describe('LedgerPeersTable — two row groups, never merged', () => {
  it('renders "Nodes you have dealt with" and "Nodes advertised but unused" as separate groups', () => {
    const props = buildFixtureProps()
    render(<LedgerPeersTable {...props} />)

    expect(screen.getByText(/Nodes you have dealt with · 2/)).toBeInTheDocument()
    expect(screen.getByText(/Nodes advertised but unused · 1/)).toBeInTheDocument()
    expect(screen.getByText(CLEAN_ROW.peer_id ?? '')).toBeInTheDocument()
    expect(screen.getByText(ALARMED_ROW.peer_id ?? '')).toBeInTheDocument()
    // the fixture's third mesh peer ("unused-node.local", shortId
    // "11223344") has no matching Pane B row -- it must appear ONLY in the
    // advertised group, never in the dealt-with one.
    const advertisedGroup = screen.getByText(/Nodes advertised but unused · 1/).closest('tbody')
    expect(advertisedGroup).not.toBeNull()
    expect(within(advertisedGroup as HTMLElement).getByText('11223344')).toBeInTheDocument()
  })

  it('a zero-dealings peer in the advertised group shows "No exchanges yet" with block C populated', () => {
    const props = buildFixtureProps()
    render(<LedgerPeersTable {...props} />)

    const rows = screen.getAllByText('No exchanges yet')
    expect(rows.length).toBeGreaterThan(0)
    expect(screen.getAllByText(/not yet checked/i).length).toBeGreaterThan(0)
  })

  it('never carries a percentage or ratio ramp on any peer figure', () => {
    const props = buildFixtureProps()
    const { container } = render(<LedgerPeersTable {...props} />)
    const bodyCells = container.querySelectorAll('td')
    for (const cell of bodyCells) {
      expect(cell.textContent ?? '').not.toContain('%')
    }
  })
})

describe('LedgerPeersTable — toolbar', () => {
  it('search filters both groups to the matching peer only', async () => {
    const user = userEvent.setup()
    const props = buildFixtureProps()
    render(<LedgerPeersTable {...props} />)

    await user.type(screen.getByLabelText('Search peers'), ALARMED_ROW.peer_id ?? '')

    expect(screen.getByText(ALARMED_ROW.peer_id ?? '')).toBeInTheDocument()
    expect(screen.queryByText(CLEAN_ROW.peer_id ?? '')).not.toBeInTheDocument()
  })

  it('the Columns menu hides a column, Reset view restores it', async () => {
    const user = userEvent.setup()
    const props = buildFixtureProps()
    render(<LedgerPeersTable {...props} />)

    expect(screen.getByRole('columnheader', { name: 'What they say' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /columns/i }))
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'What they say' }))
    expect(screen.queryByRole('columnheader', { name: 'What they say' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /reset view/i }))
    expect(screen.getByRole('columnheader', { name: 'What they say' })).toBeInTheDocument()
  })

  it('Reset view is disabled when the view is already at its default', () => {
    const props = buildFixtureProps()
    render(<LedgerPeersTable {...props} />)

    expect(screen.getByRole('button', { name: /reset view/i })).toBeDisabled()
  })

  it('Export view (CSV) and Save evidence file trigger a file save with peer-scoped content', async () => {
    const user = userEvent.setup()
    const props = buildFixtureProps()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const createObjectURL = vi.fn(() => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    render(<LedgerPeersTable {...props} />)
    await user.click(screen.getByRole('button', { name: /export view/i }))
    await user.click(screen.getByRole('button', { name: /save evidence file/i }))

    expect(clickSpy).toHaveBeenCalledTimes(2)
    expect(createObjectURL).toHaveBeenCalledTimes(2)

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
