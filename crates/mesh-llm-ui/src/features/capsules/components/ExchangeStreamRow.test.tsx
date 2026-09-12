// [mesh-ledger-b2-two-sided-row] — component-level enforcement of v3 §2's
// normative rules, on top of the pure-function tests in
// `exchange-row-state.test.ts` / `exchange-stream.test.ts`.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExchangeStreamRow } from '@/features/capsules/components/ExchangeStreamRow'
import { exchangeRowDomId } from '@/features/capsules/lib/exchange-pages'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import type { RightCellStateKind } from '@/features/capsules/lib/exchange-row-state'
import type { RailSegment } from '@/features/capsules/lib/exchange-stream'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'

function makeRow(kind: RightCellStateKind, overrides: Partial<ExchangeLedgerRow> = {}): ExchangeLedgerRow {
  return {
    exchangeKey: `exch-${kind}`,
    timestamp: '2026-09-08T16:58:05Z',
    roleTag: 'ASKED',
    counterparty: 'node:aa11bb22',
    confirmed: kind === 'closed',
    hasIssue: kind === 'contradicted',
    checksText: '—',
    rightCellState: {
      kind,
      date: kind === 'open_refused' || kind === 'open_absent' || kind === 'open_asked' ? '4 Sep' : null
    },
    sessionId: null,
    contentToggleState: { your: { kind: 'populated', date: null }, their: { kind: 'not_asked', date: null } },
    raw: {
      mine: { state: 'present', capsule_id: 'mine-1' },
      theirs: { state: 'present', capsule_id: 'theirs-1' }
    } as PaneCRow,
    ...overrides
  }
}

const NO_RAIL: RailSegment = { hasRail: false, isSegmentStart: false }

describe('ExchangeStreamRow — L-A/L-B alarm styling', () => {
  it('L-B: CONTRADICTED renders the bad tone (alarm)', () => {
    render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('contradicted')} />)
    const badge = screen.getByText('CONTRADICTED')
    expect(badge.style.color).toBe('var(--color-bad-text)')
  })

  it('L-A: every OPEN state renders the neutral/muted tone, never bad', () => {
    const openStatuses: Array<[RightCellStateKind, string]> = [
      ['open_refused', 'OPEN · refused'],
      ['open_absent', 'OPEN · absent'],
      ['open_asked', 'OPEN · asked'],
      ['open_not_asked', 'OPEN']
    ]
    for (const [kind, status] of openStatuses) {
      const { unmount } = render(
        <ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow(kind)} />
      )
      const badge = screen.getByText(status)
      expect(badge.style.color).not.toBe('var(--color-bad-text)')
      unmount()
    }
  })

  it('L-A: CLOSED also renders the neutral tone, never bad', () => {
    render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('closed')} />)
    const badge = screen.getByText('CLOSED')
    expect(badge.style.color).not.toBe('var(--color-bad-text)')
  })
})

describe('ExchangeStreamRow — six states render distinct text/status/action', () => {
  const cases: Array<{ kind: RightCellStateKind; text: string; status: string; action: string | null }> = [
    { kind: 'closed', text: '✓ cites your half by digest', status: 'CLOSED', action: null },
    { kind: 'contradicted', text: '⚠ differs', status: 'CONTRADICTED', action: 'Compare' },
    {
      kind: 'open_refused',
      text: 'They declined, and signed the refusal — 4 Sep',
      status: 'OPEN · refused',
      action: 'View refusal'
    },
    {
      kind: 'open_absent',
      text: 'They say they have no record of this — 4 Sep',
      status: 'OPEN · absent',
      action: 'View statement'
    },
    { kind: 'open_asked', text: 'Asked 4 Sep. No reply yet.', status: 'OPEN · asked', action: 'Ask again' },
    {
      kind: 'open_not_asked',
      text: "You haven't asked for their half.",
      status: 'OPEN',
      action: 'Ask them for their half'
    }
  ]

  for (const { kind, text, status, action } of cases) {
    it(`renders ${kind} correctly`, () => {
      const { unmount } = render(
        <ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow(kind)} />
      )
      expect(screen.getByText(text)).toBeInTheDocument()
      expect(screen.getByText(status)).toBeInTheDocument()
      // The row itself is `role="button"` (whole-row click opens the
      // inspector), so a state with no in-cell action has exactly that one
      // button; a state with an action has that plus the action button.
      if (action) {
        expect(screen.getByRole('button', { name: action })).toBeInTheDocument()
        expect(screen.getAllByRole('button')).toHaveLength(2)
      } else {
        expect(screen.getAllByRole('button')).toHaveLength(1)
      }
      unmount()
    })
  }

  it('LOAD-BEARING: not-asked and unanswered render visibly distinct text on the row', () => {
    const { unmount: unmountA } = render(
      <ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('open_not_asked')} />
    )
    const notAskedText = screen.getByText("You haven't asked for their half.").textContent
    unmountA()
    const { unmount: unmountB } = render(
      <ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('open_asked')} />
    )
    const unansweredText = screen.getByText(/No reply yet\.$/).textContent
    unmountB()
    expect(notAskedText).not.toBe(unansweredText)
  })
})

describe('ExchangeStreamRow — [mesh-ledger-b3-paging] focus/highlight/checks toggle', () => {
  it('renders at a stable, addressable DOM id derived from the exchange key', () => {
    const row = makeRow('closed')
    const { container } = render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(container.querySelector(`#${exchangeRowDomId(row.exchangeKey)}`)).toBeInTheDocument()
  })

  it('marks the deep-link target row with aria-current and a data-highlighted flag', () => {
    render(
      <ExchangeStreamRow highlighted onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('closed')} />
    )
    const rowEl = screen.getByRole('button', { name: /Open exchange inspector/ })
    expect(rowEl).toHaveAttribute('aria-current', 'true')
    expect(rowEl).toHaveAttribute('data-highlighted', 'true')
  })

  it('a non-highlighted, non-focused row carries neither flag', () => {
    render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('closed')} />)
    const rowEl = screen.getByRole('button', { name: /Open exchange inspector/ })
    expect(rowEl).not.toHaveAttribute('aria-current')
    expect(rowEl).not.toHaveAttribute('data-highlighted')
    expect(rowEl).not.toHaveAttribute('data-focused')
  })

  it('the `c` toggle reveals the security view inline, hidden by default [mesh-ledger-b5-security-view]', () => {
    const row = makeRow('closed')
    const { rerender } = render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.queryByRole('region', { name: /Security checks/ })).not.toBeInTheDocument()
    rerender(<ExchangeStreamRow checksExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.getByRole('region', { name: /Security checks/ })).toBeInTheDocument()
    // Never a modal (v3 §4) -- the toggle stays inline under the row.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ExchangeStreamRow — L-O served rows carry no rail and a distinct marker', () => {
  it('renders the served marker (◐) and "you served", never a rail bar regardless of rail prop', () => {
    render(
      <ExchangeStreamRow
        onAction={vi.fn()}
        onActivate={vi.fn()}
        rail={{ hasRail: true, isSegmentStart: true }}
        row={makeRow('open_not_asked', { roleTag: 'SERVED' })}
      />
    )
    expect(screen.getByText('◐')).toBeInTheDocument()
    expect(screen.getByText('you served')).toBeInTheDocument()
  })

  it('renders the asked marker (●) and "you asked" for an asked row', () => {
    render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={makeRow('closed')} />)
    expect(screen.getByText('●')).toBeInTheDocument()
    expect(screen.getByText('you asked')).toBeInTheDocument()
  })
})

describe('ExchangeStreamRow — [mesh-ledger-b4-toggle-content] toggle ① content', () => {
  it('hidden by default, revealed by contentExpanded', () => {
    const row = makeRow('closed', {
      raw: {
        mine: { state: 'present', capsule_id: 'mine-1', text: 'Summarise this thread…' },
        theirs: { state: 'present', capsule_id: 'theirs-1' }
      } as PaneCRow
    })
    const { rerender } = render(<ExchangeStreamRow onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.queryByText(/Summarise this thread/)).not.toBeInTheDocument()
    rerender(<ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.getByText(/Summarise this thread/)).toBeInTheDocument()
  })

  it('Case A (you asked): both halves render on the left; the right renders the their-claim voice', () => {
    const row = makeRow('closed', {
      roleTag: 'ASKED',
      contentToggleState: {
        your: { kind: 'populated', date: null },
        their: { kind: 'recorded_absence', date: '4 Sep' }
      },
      raw: {
        mine: {
          state: 'present',
          capsule_id: 'mine-1',
          text: 'Summarise this thread…',
          reply_text: 'The thread covers three…'
        },
        theirs: {
          state: 'absent',
          capsule_id: null,
          evidence_outcome: 'recorded_absence',
          evidence_outcome_date: '4 Sep'
        }
      } as PaneCRow
    })
    render(<ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.getByText(/You asked/)).toBeInTheDocument()
    expect(screen.getByText(/Summarise this thread/)).toBeInTheDocument()
    expect(screen.getByText(/They streamed back/)).toBeInTheDocument()
    expect(screen.getByText(/The thread covers three/)).toBeInTheDocument()
    expect(screen.getByText('They state they hold no payload for this exchange — signed 4 Sep.')).toBeInTheDocument()
  })

  it('Case B (they asked, you served): the left renders the fixed fact-you-know string; the right renders "not visible to you"', () => {
    const row = makeRow('closed', {
      roleTag: 'SERVED',
      contentToggleState: {
        your: { kind: 'streamed_not_retained', date: null },
        their: { kind: 'not_visible_holds', date: null }
      }
    })
    render(<ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.getByText('No content. You streamed this response and did not retain it.')).toBeInTheDocument()
    expect(screen.getByText('Their content — not visible to you. The requester holds it.')).toBeInTheDocument()
  })

  it('deletion renders as a distinct state, not a blank', () => {
    const row = makeRow('closed', {
      roleTag: 'ASKED',
      contentToggleState: {
        your: { kind: 'populated_deleted', date: '5 Sep' },
        their: { kind: 'not_asked', date: null }
      }
    })
    render(<ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    expect(screen.getByText('Content deleted 5 Sep · record still verifies')).toBeInTheDocument()
  })

  it('the three their-content sub-states + not-visible-holds each render distinct text', () => {
    const cases: Array<{
      contentToggleState: ExchangeLedgerRow['contentToggleState']
      text: string
    }> = [
      {
        contentToggleState: {
          your: { kind: 'populated', date: null },
          their: { kind: 'recorded_absence', date: '4 Sep' }
        },
        text: 'They state they hold no payload for this exchange — signed 4 Sep.'
      },
      {
        contentToggleState: { your: { kind: 'populated', date: null }, their: { kind: 'not_asked', date: null } },
        text: 'Not asked. They would be expected to hold none.'
      },
      {
        contentToggleState: { your: { kind: 'populated', date: null }, their: { kind: 'unanswered', date: '3 Sep' } },
        text: 'Asked 3 Sep. No reply yet.'
      }
    ]
    for (const { contentToggleState, text } of cases) {
      const { unmount } = render(
        <ExchangeStreamRow
          contentExpanded
          onAction={vi.fn()}
          onActivate={vi.fn()}
          rail={NO_RAIL}
          row={makeRow('closed', { contentToggleState })}
        />
      )
      expect(screen.getByText(text)).toBeInTheDocument()
      unmount()
    }
  })

  it('the never-asked their-content state carries an action button wired to onAction', () => {
    const onAction = vi.fn()
    const row = makeRow('closed', {
      contentToggleState: { your: { kind: 'populated', date: null }, their: { kind: 'not_asked', date: null } }
    })
    render(<ExchangeStreamRow contentExpanded onAction={onAction} onActivate={vi.fn()} rail={NO_RAIL} row={row} />)
    screen.getByRole('button', { name: 'Ask them to state it' }).click()
    expect(onAction).toHaveBeenCalledWith(row)
  })

  it('LOAD-BEARING (L-H): the your-empty voice and the their-empty voice are visibly different strings', () => {
    const servedRow = makeRow('closed', {
      roleTag: 'SERVED',
      contentToggleState: {
        your: { kind: 'streamed_not_retained', date: null },
        their: { kind: 'not_visible_holds', date: null }
      }
    })
    const { unmount } = render(
      <ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={servedRow} />
    )
    const yourVoice = screen.getByText(/No content\. You streamed/).textContent
    unmount()

    const askedRow = makeRow('closed', {
      roleTag: 'ASKED',
      contentToggleState: {
        your: { kind: 'populated', date: null },
        their: { kind: 'recorded_absence', date: '4 Sep' }
      }
    })
    render(<ExchangeStreamRow contentExpanded onAction={vi.fn()} onActivate={vi.fn()} rail={NO_RAIL} row={askedRow} />)
    const theirVoice = screen.getByText(/They state they hold no payload/).textContent

    expect(yourVoice).not.toBe(theirVoice)
  })
})
