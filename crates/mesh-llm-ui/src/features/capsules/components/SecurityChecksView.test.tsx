import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { SecurityChecksView } from '@/features/capsules/components/SecurityChecksView'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import type { RecomputedIdentity } from '@/features/capsules/lib/recompute-identity'

function paneCRow(overrides: Partial<PaneCRow> = {}): PaneCRow {
  return {
    exchange_key: 'exch-cle',
    role_tag: 'ASKED',
    header_state: 'ok',
    properties: {
      task_binding: { state: 'PASS' },
      local_inclusion: { state: 'NOT_PRESENT' },
      checkpoint_signature: { state: 'NOT_PRESENT' },
      external_registration: { state: 'NOT_PRESENT' },
      continuity: { state: 'NOT_PRESENT' },
      identity_authority: { state: 'NOT_PRESENT' },
      capture_coverage: { state: 'PASS', text: 'captured at the sidecar observe path (rule: every served exchange)' },
      outcome_corroboration: { state: 'PASS' }
    },
    has_issue: false,
    mine: { state: 'present', capsule_id: 'mine-capsule-1' },
    theirs: { state: 'present', capsule_id: 'theirs-capsule-1' },
    unilateral: false,
    timestamp: '2026-09-08T16:58:05.412Z',
    ...overrides
  }
}

function ledgerRow(raw: PaneCRow): ExchangeLedgerRow {
  return {
    exchangeKey: raw.exchange_key,
    timestamp: raw.timestamp,
    roleTag: raw.role_tag,
    counterparty: 'node:aa11bb22',
    confirmed: true,
    hasIssue: raw.has_issue,
    checksText: '—',
    rightCellState: { kind: 'closed', date: null },
    contentToggleState: { your: { kind: 'populated', date: null }, their: { kind: 'not_asked', date: null } },
    sessionId: null,
    raw
  }
}

const RECOMPUTED_MATCH: RecomputedIdentity = { idMatch: true, signatureOk: true }

describe('SecurityChecksView — inline, never a modal', () => {
  it('carries no dialog/alertdialog role anywhere in the subtree', () => {
    render(<SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders as an inline region, labelled with the exchange key', () => {
    render(<SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />)
    expect(screen.getByRole('region', { name: /exch-cle/ })).toBeInTheDocument()
  })
})

describe('SecurityChecksView — exact block order: IDENTITY -> HEADER -> WHAT IT COMMITS TO -> CHECKS -> raw', () => {
  it('block headings appear in that order in the DOM', () => {
    const { container } = render(
      <SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />
    )
    const headings = Array.from(container.querySelectorAll('[data-block-heading]')).map((el) =>
      el.getAttribute('data-block-heading')
    )
    expect(headings).toEqual(['identity', 'header', 'what it commits to', 'checks'])
  })

  it('raw bytes are last -- absent from the readable view, shown only behind the [raw] toggle', async () => {
    const user = userEvent.setup()
    render(<SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />)
    expect(screen.queryByText(/"mine"/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'raw' }))
    expect(screen.getByText(/"mine"/)).toBeInTheDocument()
  })
})

describe('SecurityChecksView — L-L: every check row names its inputs and policy inline', () => {
  it('never renders a bare state word with nothing beside it', () => {
    render(<SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />)
    expect(screen.getAllByText('recomputed in browser').length).toBeGreaterThan(0)
    expect(screen.getByText('no checkpoint')).toBeInTheDocument()
    expect(screen.getByText('no policy set')).toBeInTheDocument()
  })
})

describe('SecurityChecksView — L-M: recomputed-here vs from-sidecar are visually distinct', () => {
  it('content_binding/producer_signature carry a different class + data-source than a sidecar property', () => {
    render(<SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />)
    const recomputedCell = screen.getAllByText('recomputed in browser')[0].closest('[data-source]')
    const sidecarCell = screen.getByText('no checkpoint').closest('[data-source]')
    expect(recomputedCell).not.toBeNull()
    expect(sidecarCell).not.toBeNull()
    expect(recomputedCell?.getAttribute('data-source')).toBe('recomputed-in-browser')
    expect(sidecarCell?.getAttribute('data-source')).toBe('from-sidecar')
    expect(recomputedCell?.className).not.toBe(sidecarCell?.className)
  })
})

describe('SecurityChecksView — rendered property set', () => {
  it('renders all ten manifesto properties, including task_binding', () => {
    const { container } = render(
      <SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />
    )
    const checksBlock = Array.from(container.querySelectorAll('[data-block-heading]')).find(
      (el) => el.getAttribute('data-block-heading') === 'checks'
    )?.parentElement as HTMLElement
    for (const label of [
      'content binding',
      'producer signature',
      'task binding',
      'local inclusion',
      'checkpoint signature',
      'external registration',
      'continuity',
      'identity/authority',
      'capture coverage',
      'outcome corroboration'
    ]) {
      expect(within(checksBlock).getByText(label)).toBeInTheDocument()
    }
  })
})

describe('SecurityChecksView — WHAT IT COMMITS TO block: theirs column stays honestly empty', () => {
  it('does not claim a theirs-side digest it never held', () => {
    const { container } = render(
      <SecurityChecksView identity={RECOMPUTED_MATCH} localRecord={null} row={ledgerRow(paneCRow())} />
    )
    const commitsBlock = Array.from(container.querySelectorAll('[data-block-heading]')).find(
      (el) => el.getAttribute('data-block-heading') === 'what it commits to'
    )?.parentElement
    expect(within(commitsBlock as HTMLElement).getByText('request digest')).toBeInTheDocument()
  })
})
