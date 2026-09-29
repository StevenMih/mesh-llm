// u115 "Chat with this node": sets the host-side target for this console's
// chats, opens Chat, and says so while set, with the way back to automatic.
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RouteTargetControls } from '@/features/capsules/api/useRouteTarget'
import { CHAT_TARGET_COPY } from '@/features/capsules/lib/tooltip-copy'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const { ChatWithNodeButton } = await import('@/features/capsules/components/ChatWithNodeButton')

const NODE = 'a70d3967bea3b22fa48a28f77c5d2b3764fc8bd5204a82c09ff8430f3f2a0a00'

function controls(target: string | null, chatWith = vi.fn(async () => {})): RouteTargetControls {
  return { target, chatWith, clear: vi.fn() }
}

afterEach(() => {
  cleanup()
  navigate.mockReset()
})

describe('ChatWithNodeButton', () => {
  it('points this console’s chats at the node, then opens Chat', async () => {
    const chat = controls(null)
    render(<ChatWithNodeButton controls={chat} nodeId={NODE} />)
    await userEvent.setup().click(screen.getByRole('button', { name: CHAT_TARGET_COPY.action }))
    expect(chat.chatWith).toHaveBeenCalledWith(NODE)
    expect(navigate).toHaveBeenCalledWith({ to: '/chat' })
  })

  it('stays put and says so when the host did not take it', async () => {
    const chat = controls(
      null,
      vi.fn(async () => {
        throw new Error('HTTP 403')
      })
    )
    render(<ChatWithNodeButton controls={chat} nodeId={NODE} />)
    await userEvent.setup().click(screen.getByRole('button', { name: CHAT_TARGET_COPY.action }))
    expect(await screen.findByText(CHAT_TARGET_COPY.failed)).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('while set to this node, says so and offers the way back to automatic', async () => {
    const chat = controls(NODE)
    render(<ChatWithNodeButton controls={chat} nodeId={NODE} />)
    expect(screen.getByText(CHAT_TARGET_COPY.active)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: CHAT_TARGET_COPY.action })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: CHAT_TARGET_COPY.clear }))
    expect(chat.clear).toHaveBeenCalled()
  })

  it('set to another node, this one still offers the button', () => {
    render(<ChatWithNodeButton controls={controls('b'.repeat(64))} nodeId={NODE} />)
    expect(screen.getByRole('button', { name: CHAT_TARGET_COPY.action })).toBeInTheDocument()
  })
})
