// [ledger-T7-peers-table] Replaces `PeerCard.test.tsx` -- the row is a
// table row now (review §3-F: "Peers is a card, not the table"). [a18-
// evidence-peers-dedup-network] Accountability-only acceptance checks:
// denominator-honest adjudication, an always-visible alarm chip, and NO
// online badge / latency / Route-to-chat button anywhere in the row (moved
// to the Network tab) -- `meshStatus` is threaded through to the modal
// only.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PeerTableRow } from '@/features/capsules/components/PeerTableRow'
import {
  HARNESS_PANE_B_PAYLOAD,
  PEER_TAB_HARNESS_EXCHANGE_SOURCES,
  PEER_TAB_HARNESS_LEDGER_RECORDS,
  PEER_TAB_HARNESS_MESH_MODELS,
  PEER_TAB_HARNESS_MESH_PEERS
} from '@/features/capsules/lib/peer-fixtures'
import { deriveMeshStatus } from '@/features/capsules/lib/peer-mesh-status'
import { advertisedOnlyRowView, dealtWithRowView, SELF_REPORTED_NOTE } from '@/features/capsules/lib/peer-row-view'

const [CLEAN_ROW, ALARMED_ROW] = HARNESS_PANE_B_PAYLOAD.rows

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  )
}

describe('PeerTableRow — dealt-with peers', () => {
  it('renders the accountability columns and no alarm chip for a clean peer whose chain was peer-fetch verified', () => {
    const view = dealtWithRowView(CLEAN_ROW)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(screen.getByText('24')).toBeInTheDocument()
    expect(screen.getByText('24 / 24')).toBeInTheDocument()
    expect(screen.getByText('16 clean · 0 mismatch')).toBeInTheDocument()
    expect(screen.getByText('8 of 24 · 8 corroborated')).toBeInTheDocument()
    expect(screen.getByText('not available')).toBeInTheDocument()
    expect(screen.getByText('20 Aug – 8 Sep')).toBeInTheDocument()
    expect(screen.getByText(SELF_REPORTED_NOTE)).toBeInTheDocument()
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()
    expect(screen.queryByText(/online/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Route here' })).not.toBeInTheDocument()
  })

  it('shows a visible alarm chip for an alarmed peer, and honestly reports the peer-fetch failure and the contradiction', () => {
    const view = dealtWithRowView(ALARMED_ROW)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(screen.getByText(/⚠ Contradiction found/)).toBeInTheDocument()
    expect(screen.getByText('0 / 14 (peer-fetch failed)')).toBeInTheDocument()
    expect(screen.getByText('9 clean · 1 mismatch · 1 contradicted')).toBeInTheDocument()
    expect(screen.getByText('7 of 14 · 6 corroborated · 1 contradicted')).toBeInTheDocument()
  })

  it('resolves an alarm date from the local ledger lookup when provided', () => {
    const resolveTimestamp = vi.fn(() => '2026-09-08')
    const view = dealtWithRowView(ALARMED_ROW, resolveTimestamp)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(resolveTimestamp).toHaveBeenCalledWith('cap-alarmed-adjudication-0007')
    expect(screen.getByText(/⚠ Contradiction found 2026-09-08/)).toBeInTheDocument()
  })

  it('never renders online status, latency, or a Route here control (Network tab job)', () => {
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(CLEAN_ROW)
    const { container } = renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(screen.queryByText(/\bms\b/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Route here' })).not.toBeInTheDocument()
    expect(container.textContent).not.toContain('you measured')
  })

  it('opens the PeerInspector modal on row click, Overview tab active by default -- meshStatus still flows to the modal', async () => {
    const user = userEvent.setup()
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(CLEAN_ROW)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /overview/i })).toHaveAttribute('data-state', 'active')
    // The modal's own Overview tab still shows the operational facts --
    // only the summary row dropped them.
    expect(within(dialog).getByText('online')).toBeInTheDocument()
  })

  it('drills into the timeline with exchange sources supplied', async () => {
    const user = userEvent.setup()
    const view = dealtWithRowView(CLEAN_ROW)
    renderInTable(
      <PeerTableRow
        exchangeSources={PEER_TAB_HARNESS_EXCHANGE_SOURCES[CLEAN_ROW.peer_id ?? '']}
        meshStatus={null}
        recordsById={PEER_TAB_HARNESS_LEDGER_RECORDS}
        view={view}
      />
    )

    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))
    await user.click(screen.getByRole('tab', { name: /timeline/i }))
    expect(screen.getByText('Your exchanges')).toBeInTheDocument()
  })

  it('the Columns toggle hides one accountability column without hiding the others', () => {
    const view = dealtWithRowView(CLEAN_ROW)
    renderInTable(<PeerTableRow meshStatus={null} view={view} visibleColumns={new Set(['match'])} />)

    expect(screen.getByText('16 clean · 0 mismatch')).toBeInTheDocument()
    expect(screen.queryByText('24 / 24')).not.toBeInTheDocument()
    expect(screen.queryByText(/8 of 24/)).not.toBeInTheDocument()
  })
})

describe('PeerTableRow — advertised-but-unused peers (no Pane B row)', () => {
  it('shows "no exchanges yet" and "—" placeholders for every accountability column, and is not clickable', async () => {
    const user = userEvent.setup()
    const view = advertisedOnlyRowView('node:unused-peer')
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(screen.getByText('node:unused-peer')).toBeInTheDocument()
    expect(screen.getByText('no exchanges yet')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(5)
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()

    await user.click(screen.getByText('node:unused-peer'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
