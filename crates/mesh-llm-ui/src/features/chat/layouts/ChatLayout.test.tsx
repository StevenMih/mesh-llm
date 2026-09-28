import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatLayout } from '@/features/chat/layouts/ChatLayout'

describe('ChatLayout header', () => {
  // u97 (3): a long chat title ran under the "Model" label. The title block
  // must be allowed to shrink so its heading truncates, and the full title
  // stays readable on hover.
  it('lets a long chat title shrink and truncate instead of running under the actions', () => {
    const long = 'A very long first prompt that becomes the chat title and would otherwise run under the Model label'
    render(
      <ChatLayout
        actions={<span>Model</span>}
        composer={<textarea aria-label="Prompt" />}
        sidebar={<div />}
        sidebarMode="compact"
        title="Chat"
        subtitle={long}
      >
        <div />
      </ChatLayout>
    )
    const heading = screen.getByRole('heading', { name: long })
    expect(heading).toHaveClass('truncate')
    expect(heading).toHaveAttribute('title', long)
    const block = heading.closest('[data-chat-header-title]')
    expect(block).toHaveClass('min-w-0', 'flex-1')
    expect(block).not.toHaveClass('shrink-0')
  })
})
