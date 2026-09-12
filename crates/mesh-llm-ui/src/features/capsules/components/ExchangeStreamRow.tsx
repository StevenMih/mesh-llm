// One row of the two-sided Ledger stream ([mesh-ledger-b2-two-sided-row]).
// v3 §2's anatomy: a role marker (`●` asked / `◐` served -- no rail, L-O), a
// left session rail when this row and the previous one share a session
// (L-N), and the two-sided record itself -- `YOUR RECORD │ THEIR RECORD, AS
// GIVEN TO YOU`. The column labels themselves now live in the sticky header
// above the stream ([mesh-ledger-b3-paging], v3 §2a), not repeated per row.
// Toggle ① content ([mesh-ledger-b4-toggle-content], v3 §3) -- inline, below
// the always-visible right-cell row; a row click still opens the existing
// full-detail inspector modal, a separate concern from this toggle.
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/cn'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import { SecurityChecksView } from '@/features/capsules/components/SecurityChecksView'
import {
  theirContentAction,
  theirContentText,
  yourContentFixedText
} from '@/features/capsules/lib/exchange-content-state'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import { exchangeRowDomId } from '@/features/capsules/lib/exchange-pages'
import {
  isAlarmState,
  rightCellAction,
  rightCellStatusLabel,
  rightCellText
} from '@/features/capsules/lib/exchange-row-state'
import type { RailSegment } from '@/features/capsules/lib/exchange-stream'
import { useRecomputedIdentity } from '@/features/capsules/lib/recompute-identity'

function formatExchangeTimestamp(timestamp: string | null): string {
  if (!timestamp) return 'timestamp unavailable'
  const match = timestamp.match(/T(\d{2}:\d{2}:\d{2})Z?/)
  return match ? `${timestamp.slice(0, 10)} ${match[1]}Z` : timestamp
}

function roleText(roleTag: string): string {
  // `you served`/`you asked` are stated in words on every row -- never
  // inferred from position or colour alone (v3 §2).
  return roleTag === 'SERVED' ? 'you served' : 'you asked'
}

export type ExchangeStreamRowProps = {
  row: ExchangeLedgerRow
  rail: RailSegment
  /** Keyboard nav cursor (j/k) -- transient, not persisted anywhere. */
  focused?: boolean
  /** The per-row deep-link target (v3 §2a "opening its page with the row
   *  expanded and highlighted") -- persists until a different row is
   *  focused via deep link, independent of keyboard focus. */
  highlighted?: boolean
  /** `c` keyboard toggle -- reveals this row's Checks column value inline.
   *  Real per-row Checks toggle ② (v3 §4) is a later batch; this is the
   *  honest minimum today's data already supports (`checksText`, the same
   *  field the CSV export already uses). */
  checksExpanded?: boolean
  /** `o` keyboard toggle -- reveals this row's content cells inline
   *  ([mesh-ledger-b4-toggle-content], v3 §3): one populated side, one
   *  empty side, flipping with `Your role` (L-F). */
  contentExpanded?: boolean
  /** This row's own local capsule record ([mesh-ledger-b5-security-view]) --
   *  needed to recompute `content_binding`/`producer_signature` in-browser
   *  for the security view. `null` when the record hasn't been fetched
   *  (never a stand-in for a trusted result). */
  localRecord?: CapsuleRecord | null
  nodePubKeyPem?: string | null
  onActivate: (row: ExchangeLedgerRow) => void
  onAction: (row: ExchangeLedgerRow) => void
}

export function ExchangeStreamRow({
  row,
  rail,
  focused = false,
  highlighted = false,
  checksExpanded = false,
  contentExpanded = false,
  localRecord = null,
  nodePubKeyPem = null,
  onActivate,
  onAction
}: ExchangeStreamRowProps) {
  const state = row.rightCellState
  const alarm = isAlarmState(state)
  const action = rightCellAction(state)
  // Only recompute while the security view is actually open -- the hook
  // itself must always be called (rules of hooks), but its effect no-ops on
  // a `null` record, so collapsed rows never pay for a fetch+verify.
  const identity = useRecomputedIdentity(checksExpanded ? localRecord : null, nodePubKeyPem)
  // L-O -- served rows render a distinct marker and never a rail.
  const marker = row.roleTag === 'SERVED' ? '◐' : '●'

  return (
    <div className="flex flex-col" id={exchangeRowDomId(row.exchangeKey)}>
      {rail.isSegmentStart && row.sessionId ? (
        <p className="pl-3 pt-2 type-caption font-mono text-fg-faint">session {row.sessionId}</p>
      ) : null}
      <div
        aria-current={highlighted ? 'true' : undefined}
        aria-label={`Open exchange inspector for ${row.exchangeKey}`}
        className={cn(
          'flex cursor-pointer flex-col gap-2 border-l-2 py-3 pl-3 pr-1 outline-none',
          rail.hasRail ? 'border-accent/50' : 'border-transparent',
          focused && 'ring-1 ring-inset ring-accent/70',
          highlighted && 'bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]'
        )}
        data-focused={focused ? 'true' : undefined}
        data-highlighted={highlighted ? 'true' : undefined}
        data-right-cell-state={state.kind}
        data-role-tag={row.roleTag}
        onClick={() => onActivate(row)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onActivate(row)
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-dim">
          <span aria-hidden="true">{marker}</span>
          <time className="font-mono tabular-nums" dateTime={row.timestamp ?? undefined}>
            {formatExchangeTimestamp(row.timestamp)}
          </time>
          <span>{roleText(row.roleTag)}</span>
          {row.counterparty ? <span className="font-mono">{row.counterparty}</span> : null}
          <span className="ml-auto">
            {/* L-A/L-B: only CONTRADICTED gets alarm styling; every OPEN
               state renders the same neutral 'muted' tone as CLOSED. */}
            <StatusBadge dot={alarm} size="caption" tone={alarm ? 'bad' : 'muted'}>
              {rightCellStatusLabel(state)}
            </StatusBadge>
          </span>
        </div>
        <div className="grid grid-cols-2 gap-0 rounded border border-border-soft">
          <div className="flex flex-col gap-1 border-r border-border-soft px-3 py-2">
            <p className="font-mono text-xs text-foreground">
              <span>{row.exchangeKey}</span> · <span>{row.raw.mine.capsule_id ?? row.raw.mine.text ?? '—'}</span>
            </p>
          </div>
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <p className="text-xs text-fg-dim">{rightCellText(state)}</p>
            {action ? (
              <Button
                className="ui-control h-7 w-fit gap-1 rounded-[var(--radius)] px-2 text-[length:var(--density-type-caption)]"
                onClick={(event) => {
                  event.stopPropagation()
                  onAction(row)
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {action}
              </Button>
            ) : null}
          </div>
        </div>
        {contentExpanded ? (
          <div className="grid grid-cols-2 gap-0 rounded border border-border-soft" data-content-toggle="expanded">
            <div
              className="flex flex-col gap-1 border-r border-border-soft px-3 py-2"
              data-your-content-state={row.contentToggleState.your.kind}
            >
              {row.contentToggleState.your.kind === 'populated' ? (
                <>
                  <p className="text-xs text-foreground">
                    <span className="text-fg-faint">You asked</span> · {row.raw.mine.text ?? '—'}
                  </p>
                  {row.raw.mine.reply_text ? (
                    <p className="text-xs text-foreground">
                      <span className="text-fg-faint">They streamed back</span> · {row.raw.mine.reply_text}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-xs text-foreground">{yourContentFixedText(row.contentToggleState.your)}</p>
              )}
            </div>
            <div
              className="flex flex-col gap-1.5 px-3 py-2"
              data-their-content-state={row.contentToggleState.their.kind}
            >
              <p className="text-xs text-fg-dim">{theirContentText(row.contentToggleState.their)}</p>
              {theirContentAction(row.contentToggleState.their) ? (
                <Button
                  className="ui-control h-7 w-fit gap-1 rounded-[var(--radius)] px-2 text-[length:var(--density-type-caption)]"
                  onClick={(event) => {
                    event.stopPropagation()
                    onAction(row)
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {theirContentAction(row.contentToggleState.their)}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {checksExpanded ? <SecurityChecksView identity={identity} localRecord={localRecord} row={row} /> : null}
      </div>
    </div>
  )
}
