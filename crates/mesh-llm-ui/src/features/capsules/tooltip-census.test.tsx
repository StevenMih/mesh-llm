// Tooltip census ([mesh-evidence-tooltips-complete], UX review §8). Renders
// the real Evidence tab -- Peers, Exchanges (every row state, a TWIN pair, a
// CLOSED row's cells, the chip strip), one row's checks panel, and Integrity --
// and checks every chip TYPE the tab ships:
//   1. it renders with a tooltip (hover + a persistent aria-describedby copy);
//   2. that tooltip is short plain copy with no retired or banned phrase;
//   3. outside Dig (the checks panel), none of the engineer's words either.
// A chip type that ships without a tooltip, or with a retired phrase, fails.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { PaneCListJson, PaneCRow, PayerBook } from '@/features/capsules/api/sidecarTypes'
import { HARNESS_PANE_B_PAYLOAD } from '@/features/capsules/lib/peer-fixtures'
import { fixtureMineCell, fixtureTheirsCell } from '@/features/capsules/lib/pushed-half-fixtures'
import {
  buildSetupSteps,
  chainStripCaption,
  continuityFact,
  sealedBreakdownText
} from '@/features/capsules/lib/integrity-view'
import {
  rightCellAction,
  rightCellStatusLabel,
  rightCellText,
  type RightCellStateKind
} from '@/features/capsules/lib/exchange-row-state'
import { peerAttention } from '@/features/capsules/lib/peer-row-view'
import { dealingsLines, recordText, routingStateText } from '@/features/capsules/lib/peer-routing-view'
import * as COPY from '@/features/capsules/lib/tooltip-copy'
import * as RECORDS from '@/features/capsules/lib/your-records'
import { LedgerPageContent } from '@/features/capsules/pages/LedgerPage'

// ---------------------------------------------------------------------------
// The words. BANNED: never on screen, even negated (§8 rule 4). ENGINEER: fine
// in Dig, never outside it (§8 rule 3).
// ---------------------------------------------------------------------------
const BANNED = /\b(reputation|score|scores|rating|ranking|judgement|judgment|proven|trust score)\b/i
const ENGINEER = /\b(half|halves|capsule id|leaf|leaves|recomputed?|corroboration)\b|expand checks to fetch it/i

function checkWords(text: string, where: 'dig' | 'face'): string[] {
  const problems: string[] = []
  if (BANNED.test(text)) problems.push(`banned word: "${text}"`)
  if (where === 'face' && ENGINEER.test(text)) problems.push(`engineer's word outside Dig: "${text}"`)
  return problems
}

// ---------------------------------------------------------------------------
// The census: every chip type the tab ships, and where it lives.
// ---------------------------------------------------------------------------
const ALL_KINDS: RightCellStateKind[] = [
  'closed',
  'contradicted',
  'open_refused',
  'open_absent',
  'open_asked',
  'open_not_held',
  'open_not_given',
  'open_not_asked'
]

const REQUIRED = {
  hero: ['hero:your_records', 'hero:local_only', 'hero:digests_only', 'hero:prompts_kept'],
  // [mesh-evidence-hero-your-history-and-cleanup] the Your records panel's
  // four sharing switches.
  yourRecords: ['share:record_at_completion', 'share:history_segments', 'share:adjudications', 'share:witness'],
  peers: [
    'peer_column:exchanges',
    'peer_column:confirmed',
    'peer_column:match',
    'peer_column:adjudication',
    'peer_column:witness',
    'peer_column:period',
    'peer:self_reported',
    'peer:routing_stopped',
    'peer_attention:disagreements',
    'peer_attention:differingAnswers',
    'peer_attention:logFailed',
    'peer:payments'
  ],
  exchanges: [
    ...ALL_KINDS.map((kind) => `row_state:${kind}`),
    'entry_chip:content',
    'entry_chip:sig',
    'entry_chip:inclusion',
    'entry_chip:registered',
    'entry_chip:theirs',
    'twin:no_verdict',
    'settlement:paid',
    'settlement_state:settled',
    'settlement:provider_book'
  ],
  // The checks panel always shows at least these two (they are always
  // checked in the browser); every other chip it shows must carry one too.
  // UX §3: the CLOSED per-property cells lead the expansion of a CLOSED row.
  checks: [
    'closed_cell:their_id',
    'closed_cell:signature',
    'closed_cell:request',
    'closed_cell:response',
    'check_chip:content_binding',
    'check_chip:producer_signature',
    'settlement_source:payer_asserted',
    'settlement_source:provider_asserted',
    'settlement_source:wallet_reported'
  ],
  // [mesh-evidence-history-surface] the peer drill's "Their history" tab.
  peerHistory: [
    'peer_history:dealings',
    'peer_history:theirLog',
    'peer_history:othersSay',
    'peer_history:verdicts',
    'peer_history:askedOfYou'
  ],
  integrity: [
    'integrity_tile:Sealed',
    'integrity_tile:Shared with a witness',
    'integrity_tile:Confirmed by the other side',
    'integrity_tile:Disagreements',
    'integrity:chain_strip',
    'integrity:close_card'
  ]
} as const

// ---------------------------------------------------------------------------
// Fixtures: one Pane C row per right-cell state, a TWIN pair, pushed halves.
// ---------------------------------------------------------------------------
function row(key: string, overrides: Partial<PaneCRow>): PaneCRow {
  return {
    exchange_key: key,
    role_tag: 'ASKED',
    counterparty: 'node:aa11bb22',
    header_state: 'absent',
    properties: null,
    has_issue: false,
    mine: { state: 'present-unverified', capsule_id: 'd'.repeat(64) },
    theirs: { state: 'absent', capsule_id: null },
    unilateral: true,
    timestamp: '2026-09-26T10:00:00Z',
    ...overrides
  }
}

const CENSUS_SETTLEMENT: PayerBook = {
  observed_by: 'payer',
  state: 'settled',
  terms_digests: ['t'.repeat(64)],
  provider_book: 'not_available',
  entries: [
    {
      capsule_id: 's1',
      timestamp: null,
      phase: 'terms_accepted',
      source: 'payer_asserted',
      segment: null,
      payment_hash: null,
      amount_msat: 900
    },
    {
      capsule_id: 's2',
      timestamp: null,
      phase: 'input_invoice_issued',
      source: 'provider_asserted',
      segment: 0,
      payment_hash: 'a'.repeat(64),
      amount_msat: 120
    },
    {
      capsule_id: 's3',
      timestamp: null,
      phase: 'input_settlement_observed',
      source: 'wallet_reported',
      segment: 0,
      payment_hash: 'a'.repeat(64),
      amount_msat: 120
    }
  ]
}

const PANE_C: PaneCListJson = {
  row_count: 10,
  default_sort: 'timestamp',
  filters: ['all', 'served', 'asked', 'issues'],
  next_after_seq: null,
  archived_segments: [],
  rows: [
    row('exch-closed', {
      mine: fixtureMineCell(),
      theirs: fixtureTheirsCell('agrees'),
      unilateral: false,
      settlement: CENSUS_SETTLEMENT
    }),
    row('exch-contradicted', { mine: fixtureMineCell(), theirs: fixtureTheirsCell('disagrees'), unilateral: false }),
    row('exch-refused', {
      theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'signed_refusal', evidence_outcome_date: '4 Sep' }
    }),
    row('exch-absent', {
      theirs: {
        state: 'absent',
        capsule_id: null,
        evidence_outcome: 'recorded_absence',
        evidence_outcome_date: '4 Sep'
      }
    }),
    row('exch-asked', {
      theirs: { state: 'absent', capsule_id: null, evidence_outcome: 'unanswered', evidence_outcome_date: '3 Sep' }
    }),
    row('exch-not-held', { theirs: { state: 'NOT_CHECKED', capsule_id: 'e'.repeat(64), peer_id: 'peer-1' } }),
    row('exch-not-given', { theirs: { state: 'NOT_CHECKED', capsule_id: 'capsule-chatcmpl-1', peer_id: 'peer-1' } }),
    row('exch-not-asked', {}),
    row('exch-twin-a', { twin_bracket_id: 'twin-census', timestamp: '2026-09-26T11:00:00Z' }),
    row('exch-twin-b', { twin_bracket_id: 'twin-census', timestamp: '2026-09-26T11:00:01Z' })
  ]
}

vi.mock('@/features/capsules/api/sidecarClient', () => ({
  fetchPaneA: vi.fn().mockResolvedValue({ rows: [], operator: null, witness_checkpoint_supplied: false, card: null }),
  // Peer 0 carries settlement counts; peer 1 carries a full node id and a
  // local block (§7.5), so both the payments line and the `routing stopped`
  // chip are on screen for the census.
  fetchPaneB: vi.fn(async () => ({
    ...HARNESS_PANE_B_PAYLOAD,
    rows: HARNESS_PANE_B_PAYLOAD.rows.map((peer, index) =>
      index === 0
        ? {
            ...peer,
            settlement: {
              paid_exchanges: 1,
              settled_payer_observed: 1,
              no_settlement_seen: 0,
              settled_both_books: null,
              lapsed: null,
              debt: null,
              provider_book: 'not_available'
            }
          }
        : index === 1
          ? { ...peer, identity: { node_id: 'f'.repeat(64), node_id_source: 'your_records' } }
          : peer
    )
  })),
  fetchPaneCList: vi.fn(async () => PANE_C)
}))
vi.mock('@/features/capsules/api/peerBlocksClient', () => ({
  fetchPeerBlocks: vi.fn(async () => ({
    blocks: { ['f'.repeat(64)]: { blocked_at_ms: 0, until_ms: null } },
    choices: []
  })),
  blockPeer: vi.fn(),
  unblockPeer: vi.fn()
}))
vi.mock('@/features/capsules/api/recordsClient', () => ({
  fetchRecordsStatus: vi.fn().mockResolvedValue({
    records_path: '/data/ledger',
    record_count: 10,
    head: null,
    log_id: 'capsule-emit-mesh',
    stored_text_count: 3,
    new_history_pending: null,
    // All four off, so the conditional `Local only` pill renders and its
    // tooltip is counted too.
    sharing: {
      record_at_completion: { value: 'off', source: 'set' },
      history_segments: { value: 'off', source: 'set' },
      adjudications: { value: 'off', source: 'set' },
      witness: { value: null, source: 'default' }
    }
  }),
  runCleanup: vi.fn()
}))
vi.mock('@/features/capsules/api/client', () => ({
  fetchCapsuleLedger: vi.fn().mockResolvedValue({ records: [], nodePubKeyPem: null }),
  fetchSignedStatement: vi.fn().mockResolvedValue(null)
}))
vi.mock('@/features/network/api/use-status-query', () => ({
  useStatusQuery: vi.fn(() => ({ data: undefined }))
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// ---------------------------------------------------------------------------
// Reading a rendered chip's tooltip: the sr-only copy its describedby names.
// ---------------------------------------------------------------------------
function tooltipFor(censusElement: Element): string {
  const described = censusElement.querySelector('[aria-describedby]')
  const id = described?.getAttribute('aria-describedby')
  return (id ? document.getElementById(id)?.textContent : null)?.trim() ?? ''
}

function censusOnScreen(): Map<string, string> {
  const found = new Map<string, string>()
  for (const el of document.querySelectorAll('[data-census-chip]')) {
    const key = el.getAttribute('data-census-chip') as string
    if (!found.has(key)) found.set(key, tooltipFor(el))
  }
  return found
}

function expectCovered(required: readonly string[], seen: Map<string, string>, where: 'dig' | 'face') {
  const missing = required.filter((key) => !seen.has(key))
  expect(missing, 'chip types rendered without a tooltip').toEqual([])
  for (const key of required) {
    const tooltip = seen.get(key) ?? ''
    expect(tooltip.length, `${key} has an empty tooltip`).toBeGreaterThan(0)
    expect(checkWords(tooltip, where), key).toEqual([])
  }
}

describe('tooltip census -- every chip type the Evidence tab ships has a plain one-line tooltip', () => {
  it('Peers + hero: every column header, the identity note and each counted badge', async () => {
    render(<LedgerPageContent />, { wrapper })
    await screen.findByText(/Nodes you have dealt with/)
    await screen.findByText('Your prompts · kept here')
    await screen.findByText('Local only')
    const seen = censusOnScreen()
    expectCovered(REQUIRED.hero, seen, 'face')
    expectCovered(REQUIRED.peers, seen, 'face')
    // The live/local chip: one of the two, whichever state the page is in.
    expect(seen.has('hero:live') || seen.has('hero:local') || seen.has('hero:sample')).toBe(true)
    // No generic warning glyph anywhere on the Peers face (§8).
    expect(document.body.textContent).not.toContain('⚠')
  })

  it('Exchanges: every row state, the CLOSED cells, the chip strip and the TWIN badge', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /exchanges/i }))
    await screen.findAllByText(/You haven’t asked for their record\./)
    expectCovered(REQUIRED.exchanges, censusOnScreen(), 'face')
  })

  it('row expansion (Dig): every chip in the checks panel has a hover, and the click still opens the full explanation', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /exchanges/i }))
    const closedRow = await screen.findByRole('group', { name: 'Exchange exch-closed' })
    await user.click(within(closedRow).getByRole('button', { name: /checks/ }))
    const panel = await screen.findByLabelText('Security checks for exch-closed')

    const seen = censusOnScreen()
    expectCovered(REQUIRED.checks, seen, 'dig')
    // Every chip trigger in the panel is wrapped by a census entry with a hover.
    const triggers = panel.querySelectorAll('button[aria-haspopup="dialog"]')
    expect(triggers.length).toBeGreaterThan(0)
    for (const trigger of triggers) {
      const census = trigger.closest('[data-census-chip]')
      expect(census, `a checks chip ships without a hover: "${trigger.textContent}"`).not.toBeNull()
      expect(checkWords(tooltipFor(census as Element), 'dig')).toEqual([])
    }
    // Click-through still works: the four-part explanation opens.
    await user.click(triggers[0] as HTMLElement)
    expect(await screen.findByText(/What this means:/)).toBeInTheDocument()
  })

  it('Your records panel: every sharing switch', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('button', { name: /Your records/ }))
    await screen.findByRole('dialog', { name: 'Your records' })
    expectCovered(REQUIRED.yourRecords, censusOnScreen(), 'face')
  })

  it('Peer drill: every section of Their log, as shown to you', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    const [firstPeer] = await screen.findAllByRole('row', { name: /Open peer inspector for/ })
    await user.click(firstPeer)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('tab', { name: /their log, as shown to you/i }))
    expect(within(dialog).queryByText(/their history/i)).not.toBeInTheDocument()
    expectCovered(REQUIRED.peerHistory, censusOnScreen(), 'face')
    // The section bodies too, not only their tooltips.
    const panel = within(dialog).getByRole('tabpanel')
    expect(checkWords(panel.textContent ?? '', 'face')).toEqual([])
  })

  it('Integrity: every tile and the chain strip', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /integrity/i }))
    await screen.findByText(/Register your checkpoints/)
    expectCovered(REQUIRED.integrity, censusOnScreen(), 'face')
  })
})

describe('tooltip census -- the copy itself', () => {
  it('every registered tooltip is one or two plain sentences with no banned word; outside Dig, no engineer’s words', () => {
    const face: string[] = [
      ...Object.values(COPY.HERO_TOOLTIPS),
      COPY.HERO_DESCRIPTION,
      ...Object.values(COPY.PEER_COLUMN_TOOLTIPS),
      COPY.SELF_REPORTED_TOOLTIP,
      COPY.ROUTING_STOPPED_TOOLTIP,
      COPY.PEER_INSPECTOR_HEADER,
      ...Object.values(COPY.PEER_HISTORY_TOOLTIPS),
      ...Object.values(COPY.PEER_ATTENTION).flatMap((entry) => [entry.tooltip(1), entry.tooltip(2)]),
      ...Object.values(COPY.ROW_STATE_TOOLTIPS),
      ...Object.values(COPY.CLOSED_CELL_TOOLTIPS),
      ...Object.values(COPY.ENTRY_CHIP_TOOLTIPS),
      COPY.TWIN_NO_VERDICT_TOOLTIP,
      ...Object.values(COPY.INTEGRITY_TILE_TOOLTIPS),
      COPY.CHAIN_STRIP_TOOLTIP,
      COPY.SETTLEMENT_PAID_TOOLTIP,
      COPY.SETTLEMENT_PRICED_TOOLTIP,
      ...Object.values(COPY.SETTLEMENT_STATE_TOOLTIPS),
      COPY.SETTLEMENT_PROVIDER_BOOK_TOOLTIP,
      ...Object.values(COPY.SETTLEMENT_SOURCE_TOOLTIPS),
      COPY.PEER_PAYMENTS_TOOLTIP,
      COPY.CLOSE_CARD_TOOLTIP,
      ...Object.values(RECORDS.SHARING_GOVERNS),
      // [mesh-chat-evidence-chip] the Chat chip and the Logs link sit on
      // other tabs' faces, so the same face rules apply.
      ...Object.values(COPY.CHAT_EVIDENCE_CHIP_TOOLTIPS),
      COPY.LOGS_EVIDENCE_LINK_TOOLTIP
    ]
    const dig = Object.values(COPY.CHECK_CHIP_TOOLTIPS)
    for (const text of [...face, ...dig]) {
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text.endsWith('.'), `not a full sentence: "${text}"`).toBe(true)
      expect(text.split(/(?<=[.!?])\s+/).length, `more than two sentences: "${text}"`).toBeLessThanOrEqual(2)
    }
    expect(face.flatMap((text) => checkWords(text, 'face'))).toEqual([])
    expect(dig.flatMap((text) => checkWords(text, 'dig'))).toEqual([])
  })

  it('the peer drill’s routing section and dialog carry no banned or engineer’s word, and never report or share', () => {
    const texts = [
      COPY.YOUR_DEALINGS_TITLE,
      COPY.ROUTING_STOPPED_LABEL,
      ...Object.values(COPY.ROUTING_BLOCK_COPY).flatMap((value) => (typeof value === 'string' ? [value] : [...value])),
      // The composed lines the section shows, every variant.
      routingStateText({ kind: 'stopped', untilMs: Date.UTC(2026, 9, 4), last: null }),
      routingStateText({ kind: 'stopped', untilMs: null, last: null }),
      routingStateText({ kind: 'routing', last: { change: 'unblock', peer: 'p', at_ms: 0, capsule_id: null } }),
      ...(['block', 'unblock'] as const).flatMap((change) =>
        [null, 'c'].map((capsule_id) => recordText({ change, peer: 'p', at_ms: 0, capsule_id }) ?? '')
      ),
      ...dealingsLines(HARNESS_PANE_B_PAYLOAD.rows[0])
    ]
    expect(texts.flatMap((text) => checkWords(text, 'face'))).toEqual([])
    expect(texts.filter((text) => /\b(report|blocklist|flag|share|shared)\b/i.test(text))).toEqual([])
  })

  it('the row faces, actions and badges carry no banned or engineer’s word', () => {
    const texts = ALL_KINDS.flatMap((kind) => {
      const state = { kind, date: '4 Sep' }
      return [rightCellText(state), rightCellStatusLabel(state), rightCellAction(state) ?? '']
    })
    expect(texts.flatMap((text) => checkWords(text, 'face'))).toEqual([])
  })

  it('Your records and Clean up records faces carry no banned or engineer’s word', () => {
    const texts = [
      RECORDS.NO_SINGLE_RECORD_DELETE,
      RECORDS.CLEANUP_IS_ON_THE_RECORD,
      RECORDS.START_NEW_LOG_CONFIRM,
      RECORDS.NEW_LOG_PENDING,
      RECORDS.SHARING_NOT_SHOWN,
      ...RECORDS.CLEANUP_OPTIONS.flatMap((o) => [o.title, o.consequence, o.button]),
      ...RECORDS.sharingRows(null).flatMap((r) => [r.label, r.whatLeaves]),
      ...['counterparty', 'off'].flatMap((v) =>
        RECORDS.sharingRows({
          sharing: {
            record_at_completion: { value: v, source: 'set' },
            history_segments: { value: v === 'off' ? 'off' : 'peers', source: 'set' },
            adjudications: { value: v, source: 'set' },
            witness: { value: v === 'off' ? null : 'https://witness.example', source: 'set' }
          }
        } as never).flatMap((r) => [r.state ?? '', r.whatLeaves])
      ),
      RECORDS.heroStatusLine({ records: 1, confirmed: 1, disagreements: 1, witnessed: true }),
      RECORDS.heroStatusLine({ records: 8, confirmed: 3, disagreements: 0, witnessed: false })
    ]
    expect(texts.flatMap((text) => checkWords(text, 'face'))).toEqual([])
  })

  it('Integrity faces: setup steps and every chain caption variant', () => {
    const steps = buildSetupSteps({ checkpoint_count: 0 }, null)
    const texts = [
      ...steps.flatMap((step) => [step.title, step.status, step.body ?? '']),
      chainStripCaption(5, 1, 1),
      chainStripCaption(5, 1, 3),
      chainStripCaption(5, 2, null),
      chainStripCaption(2, null, null),
      chainStripCaption(1, 0, null),
      chainStripCaption(8, 1, 8),
      ...buildSetupSteps({ checkpoint_count: 1 }, { verified: true }, 3).flatMap((step) => [
        step.title,
        step.status,
        step.body ?? ''
      ]),
      continuityFact(null),
      continuityFact(1),
      continuityFact(3),
      sealedBreakdownText(5, 3)
    ]
    expect(texts.flatMap((text) => checkWords(text, 'face'))).toEqual([])
  })

  it('the counted peer badges name the specific thing and count it; the two uncounted states are named, not numbered', () => {
    const [clean, alarmed] = HARNESS_PANE_B_PAYLOAD.rows
    expect(peerAttention(clean)).toEqual([])
    expect(peerAttention(alarmed).map((item) => item.label)).toEqual([
      '1 disagreement',
      '1 differing answer',
      'log didn’t check out'
    ])
    const failedLog = peerAttention({ ...clean, history: { ...clean.history, state: 'failed' } })
    expect(failedLog.map((item) => item.label)).toEqual(['log didn’t check out'])
    const refused = peerAttention({ ...clean, served: { ...clean.served, state: 'refused' } })
    expect(refused.map((item) => item.label)).toEqual(['refused a request'])
  })
})

describe('settlement on the Evidence tab', () => {
  it('a paid exchange shows CLOSED (inference) and settled (your wallet) on one row; an unpaid-looking free row shows neither', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /exchanges/i }))
    const closedRow = await screen.findByRole('group', { name: 'Exchange exch-closed' })
    expect(closedRow.getAttribute('data-right-cell-state')).toBe('closed')
    expect(within(closedRow).getByText('CLOSED')).toBeInTheDocument()
    const payment = within(closedRow).getByRole('group', { name: 'payment' })
    expect(payment.getAttribute('data-settlement-state')).toBe('settled')
    expect(within(payment).getByText('settled · your wallet')).toBeInTheDocument()
    expect(within(payment).getByText('provider’s book: not available')).toBeInTheDocument()
    // A row with no payment records carries no payment strip at all -- never "unpaid".
    const freeRow = screen.getByRole('group', { name: 'Exchange exch-not-asked' })
    expect(within(freeRow).queryByRole('group', { name: 'payment' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/unpaid/i)
  })

  it('the checks expansion lists each payment step with who stated it and the amount as recorded', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /exchanges/i }))
    const closedRow = await screen.findByRole('group', { name: 'Exchange exch-closed' })
    await user.click(within(closedRow).getByRole('button', { name: /checks/ }))
    const records = within(closedRow).getByRole('group', { name: 'payment records' })
    expect(within(records).getByText('recorded 900 msat')).toBeInTheDocument()
    expect(within(records).getAllByText('recorded 120 msat')).toHaveLength(2)
    expect(within(records).getByText('your wallet reported')).toBeInTheDocument()
    // Amounts are facts on entries; nothing adds them up.
    expect(records.textContent).not.toMatch(/1140|total/i)
  })

  it('the Close card counts CLOSED and settled over the same rows', async () => {
    const user = userEvent.setup()
    render(<LedgerPageContent />, { wrapper })
    await user.click(await screen.findByRole('tab', { name: /integrity/i }))
    const card = await screen.findByTestId('close-card')
    expect(within(card).getByText('none yet')).toBeInTheDocument()
    expect(card.querySelector('[data-close-inference]')?.textContent).toBe(
      'So far: 10 exchanges · 1 confirmed by the other side'
    )
    expect(card.querySelector('[data-close-settlement]')?.textContent).toBe(
      '1 paid · 1 settled by your wallet · provider’s book: not available'
    )
  })

  it('the Peers row counts paid and settled, and never counts lapsed or debts it cannot see', async () => {
    render(<LedgerPageContent />, { wrapper })
    await screen.findByText(/Nodes you have dealt with/)
    const line = document.querySelector('[data-peer-payments]')
    expect(line?.textContent).toBe(
      'Payments: 1 paid · 1 settled by your wallet · lapsed and debts: provider’s book: not available'
    )
  })
})
