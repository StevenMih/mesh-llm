import '@testing-library/jest-dom/vitest'

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LOGS_EVIDENCE_LINK_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'
import { LogsEvidenceLink } from '@/features/logs/components/LogsEvidenceLink'

describe('LogsEvidenceLink ([mesh-chat-evidence-chip])', () => {
  it('links the exchange id to its Evidence row without opening the row inspector', () => {
    const openInspector = vi.fn()
    render(
      <div onClick={openInspector}>
        <LogsEvidenceLink exchangeId="8a7f2218-4311-4f53-9857-9c2fd8a137b2" />
      </div>
    )

    const link = screen.getByRole('link', { name: 'Open exchange 8a7f2218-4311-4f53-9857-9c2fd8a137b2 in Evidence' })
    expect(link).toHaveAttribute('href', '/capsules/exchange/8a7f2218-4311-4f53-9857-9c2fd8a137b2')
    expect(link).toHaveAttribute('title', LOGS_EVIDENCE_LINK_TOOLTIP)

    fireEvent.click(link)
    expect(openInspector).not.toHaveBeenCalled()
  })
})
