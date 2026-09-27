// §7.5: the drill's `Stop routing to this peer` -- a local block, said as
// only-your-node · nobody-told · undoable, two lengths, and nothing that
// reports or shares.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import type { PeerRoutingControls } from '@/features/capsules/api/usePeerBlocks'
import { PeerRoutingSection } from '@/features/capsules/components/PeerRoutingSection'
import { HARNESS_PANE_B_PAYLOAD } from '@/features/capsules/lib/peer-fixtures'
import type { PeerBlocksJson } from '@/features/capsules/lib/peer-routing-view'
import { ROUTING_BLOCK_COPY, SAMPLE_DATA_UNAVAILABLE } from '@/features/capsules/lib/tooltip-copy'

const NODE = 'a70d3967bea3b22fa48a28f77c5d2b3764fc8bd5204a82c09ff8430f3f2a0a00'
const AT = Date.UTC(2026, 8, 27)
const ROW: PaneBRow = { ...HARNESS_PANE_B_PAYLOAD.rows[0], identity: { node_id: NODE, node_id_source: 'your_records' } }

function controls(blocks: PeerBlocksJson | undefined): PeerRoutingControls {
  return { blocks, block: vi.fn(), unblock: vi.fn(), failedFor: null }
}

const NONE: PeerBlocksJson = { blocks: {}, choices: [] }
const STOPPED: PeerBlocksJson = {
  blocks: { [NODE]: { blocked_at_ms: AT, until_ms: null } },
  choices: [{ change: 'block', peer: NODE, at_ms: AT, until_ms: null, capsule_id: 'c'.repeat(64) }]
}

describe('PeerRoutingSection', () => {
  it('opens a dialog that says exactly the three facts and offers exactly the two lengths', async () => {
    const user = userEvent.setup()
    const routing = controls(NONE)
    render(<PeerRoutingSection routing={routing} row={ROW} sampleData={false} />)
    expect(screen.getByText(ROUTING_BLOCK_COPY.routing)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: ROUTING_BLOCK_COPY.stopAction }))
    const dialog = await screen.findByRole('alertdialog')
    const facts = within(dialog)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(facts).toEqual(['This is only on your node.', 'Nobody else is told.', 'You can undo it.'])
    const buttons = within(dialog)
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(buttons).toEqual(['Cancel', 'Block for 7 days', 'Block until I undo'])
    // No shared list, no report: nothing in the dialog offers either.
    expect(dialog.textContent).not.toMatch(/report|share|blocklist|flag/i)

    await user.click(within(dialog).getByRole('button', { name: 'Block for 7 days' }))
    expect(routing.block).toHaveBeenCalledWith(NODE, 'seven_days')
  })

  it('until-undone passes its own length', async () => {
    const user = userEvent.setup()
    const routing = controls(NONE)
    render(<PeerRoutingSection routing={routing} row={ROW} sampleData={false} />)
    await user.click(screen.getByRole('button', { name: ROUTING_BLOCK_COPY.stopAction }))
    await user.click(await screen.findByRole('button', { name: 'Block until I undo' }))
    expect(routing.block).toHaveBeenCalledWith(NODE, 'until_undone')
  })

  it('a stopped peer shows the state, the sealed record, and Resume -- which undoes it', async () => {
    const user = userEvent.setup()
    const routing = controls(STOPPED)
    render(<PeerRoutingSection routing={routing} row={ROW} sampleData={false} />)
    expect(screen.getByText('Stopped until you undo it, by your choice. Only on your node.')).toBeInTheDocument()
    expect(screen.getByText('The block is sealed on your records.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: ROUTING_BLOCK_COPY.stopAction })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: ROUTING_BLOCK_COPY.resumeAction }))
    expect(routing.unblock).toHaveBeenCalledWith(NODE)
  })

  it('on sample data the dialog still reads, but nothing can be blocked, and it says why', async () => {
    const user = userEvent.setup()
    const routing = controls(NONE)
    render(<PeerRoutingSection routing={routing} row={ROW} sampleData />)
    await user.click(screen.getByRole('button', { name: ROUTING_BLOCK_COPY.stopAction }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByRole('button', { name: 'Block for 7 days' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Block until I undo' })).toBeDisabled()
    expect(within(dialog).getByText(SAMPLE_DATA_UNAVAILABLE)).toBeInTheDocument()
  })

  it('a row with no full node id says so and offers no action', () => {
    const keyOnly: PaneBRow = { ...ROW, identity: { signing_key_id: 'd'.repeat(64), endpoint_id: 'e5ba9d1001' } }
    render(<PeerRoutingSection routing={controls(NONE)} row={keyOnly} sampleData={false} />)
    expect(screen.getByText(ROUTING_BLOCK_COPY.noNodeId)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a failed change is said on the peer it failed for, and on no other', () => {
    const { unmount } = render(
      <PeerRoutingSection routing={{ ...controls(NONE), failedFor: NODE }} row={ROW} sampleData={false} />
    )
    expect(screen.getByText(ROUTING_BLOCK_COPY.failed)).toBeInTheDocument()
    unmount()
    render(
      <PeerRoutingSection routing={{ ...controls(NONE), failedFor: 'e'.repeat(64) }} row={ROW} sampleData={false} />
    )
    expect(screen.queryByText(ROUTING_BLOCK_COPY.failed)).not.toBeInTheDocument()
  })
})
