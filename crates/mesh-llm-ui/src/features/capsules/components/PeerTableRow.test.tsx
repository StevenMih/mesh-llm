// [ledger-T7-peers-table] Replaces `PeerCard.test.tsx` -- the row is a
// table row now (review §3-F: "Peers is a card, not the table"), same
// honesty-backbone acceptance checks: with-you-front, denominator-honest
// adjudication, an always-visible alarm chip, and the Route here disabled
// reason as VISIBLE text (never a tooltip). `useNavigate` is exercised
// outside a `RouterProvider` -- it degrades to a console warning rather
// than throwing, so no router wrapper is needed for this render-only check.
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
import { advertisedOnlyRowView, dealtWithRowView, ROUTE_DISABLED_REASON } from '@/features/capsules/lib/peer-row-view'

const [CLEAN_ROW, ALARMED_ROW] = HARNESS_PANE_B_PAYLOAD.rows

function renderInTable(ui: React.ReactElement) {
  return render(
    <table>
      <tbody>{ui}</tbody>
    </table>
  )
}

describe('PeerTableRow — dealt-with peers', () => {
  it('renders with-you-front counts, a denominator-honest adjudication line, and no alarm chip for a clean peer', () => {
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(CLEAN_ROW, meshStatus)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(screen.getByText('16 requested · 8 served · 16 confirmed')).toBeInTheDocument()
    expect(screen.getByText(/8 of 24 adjudicated · 8 corroborated/)).toBeInTheDocument()
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()
  })

  it('shows a visible alarm chip for an alarmed peer, never hiding the contradiction as corroborated-only', () => {
    const meshStatus = deriveMeshStatus(
      ALARMED_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(ALARMED_ROW, meshStatus)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

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
    const view = dealtWithRowView(ALARMED_ROW, meshStatus, resolveTimestamp)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(resolveTimestamp).toHaveBeenCalledWith('cap-alarmed-adjudication-0007')
    expect(screen.getByText(/⚠ Contradiction found 2026-09-08/)).toBeInTheDocument()
  })

  it('review §3-F: the Route here disabled reason is VISIBLE TEXT, not a tooltip -- never fabricates a model when the mesh join misses', () => {
    const view = dealtWithRowView(CLEAN_ROW, null)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    const button = screen.getByRole('button', { name: 'Route here' })
    expect(button).toBeDisabled()
    // The old bug hid this reason in a `title` attribute (screen-reader/
    // hover only). It must be a real text node in the DOM.
    expect(button).not.toHaveAttribute('title')
    expect(screen.getByText(ROUTE_DISABLED_REASON)).toBeInTheDocument()
  })

  it('falls back to "mesh status not available" when block A has nothing at all to report', () => {
    const bareRow = { ...CLEAN_ROW, rung: { state: 'absent', text: null } }
    const view = dealtWithRowView(bareRow, null)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(screen.getByText('mesh status not available')).toBeInTheDocument()
  })

  it('Route here does not open the inspector modal (stops the row click from bubbling)', async () => {
    const user = userEvent.setup()
    const view = dealtWithRowView(CLEAN_ROW, null)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    await user.click(screen.getByRole('button', { name: 'Route here' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the PeerInspector modal on row click, Overview tab active by default', async () => {
    const user = userEvent.setup()
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(CLEAN_ROW, meshStatus)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByText(CLEAN_ROW.peer_id ?? ''))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: /overview/i })).toHaveAttribute('data-state', 'active')
  })

  it('drills into the timeline with exchange sources supplied', async () => {
    const user = userEvent.setup()
    const view = dealtWithRowView(CLEAN_ROW, null)
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

  it('the Columns toggle hides a block without hiding the others', () => {
    const meshStatus = deriveMeshStatus(
      CLEAN_ROW.peer_id ?? '',
      PEER_TAB_HARNESS_MESH_PEERS,
      PEER_TAB_HARNESS_MESH_MODELS
    )
    const view = dealtWithRowView(CLEAN_ROW, meshStatus)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} visibleBlocks={new Set(['B'])} />)

    expect(screen.getByText('16 requested · 8 served · 16 confirmed')).toBeInTheDocument()
    expect(screen.queryByText(/8 of 24 adjudicated/)).not.toBeInTheDocument()
  })
})

describe('PeerTableRow — advertised-but-unused peers (no Pane B row)', () => {
  it('shows "No exchanges yet" and a populated (non-blank) block C, and is not clickable', async () => {
    const user = userEvent.setup()
    const view = advertisedOnlyRowView('node:unused-peer', null)
    renderInTable(<PeerTableRow meshStatus={null} view={view} />)

    expect(screen.getByText('No exchanges yet')).toBeInTheDocument()
    expect(screen.getByText(/not yet checked/i)).toBeInTheDocument()
    expect(screen.queryByText(/⚠/)).not.toBeInTheDocument()

    await user.click(screen.getByText('node:unused-peer'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Route here still works identically for an advertised-only peer with a resolved mesh status', () => {
    const meshStatus = deriveMeshStatus('aa11bb22cc33dd44', PEER_TAB_HARNESS_MESH_PEERS, PEER_TAB_HARNESS_MESH_MODELS)
    const view = advertisedOnlyRowView('aa11bb22cc33dd44', meshStatus)
    renderInTable(<PeerTableRow meshStatus={meshStatus} view={view} />)

    expect(screen.getByRole('button', { name: 'Route here' })).toBeEnabled()
  })
})
