// [mesh-ledger-b2-two-sided-row] — component-level enforcement of v3 §2's
// normative rules, on top of the pure-function tests in
// `exchange-row-state.test.ts` / `exchange-stream.test.ts`.
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExchangeStreamRow } from '@/features/capsules/components/ExchangeStreamRow'
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
    raw: { mine: { state: 'present', capsule_id: 'mine-1' } } as PaneCRow,
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
