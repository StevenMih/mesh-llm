// One row of the two-sided Ledger stream ([mesh-ledger-b2-two-sided-row]).
// v3 §2's anatomy: a role marker (`●` asked / `◐` served -- no rail, L-O), a
// left session rail when this row and the previous one share a session
// (L-N), and the two-sided record itself -- `YOUR RECORD │ THEIR RECORD, AS
// GIVEN TO YOU`. Toggles ① content and ② checks (v3 §3/§4) are later
// batches; clicking a row here still opens the existing full-detail
// inspector modal, same as before this batch.
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import {
  isAlarmState,
  rightCellAction,
  rightCellStatusLabel,
  rightCellText
} from '@/features/capsules/lib/exchange-row-state'
import type { RailSegment } from '@/features/capsules/lib/exchange-stream'

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
  onActivate: (row: ExchangeLedgerRow) => void
  onAction: (row: ExchangeLedgerRow) => void
}

export function ExchangeStreamRow({ row, rail, onActivate, onAction }: ExchangeStreamRowProps) {
  const state = row.rightCellState
  const alarm = isAlarmState(state)
  const action = rightCellAction(state)
  // L-O -- served rows render a distinct marker and never a rail.
  const marker = row.roleTag === 'SERVED' ? '◐' : '●'

  return (
    <div className="flex flex-col">
      {rail.isSegmentStart && row.sessionId ? (
        <p className="pl-3 pt-2 type-caption font-mono text-fg-faint">session {row.sessionId}</p>
      ) : null}
      <div
        aria-label={`Open exchange inspector for ${row.exchangeKey}`}
        className={`flex cursor-pointer flex-col gap-2 border-l-2 py-3 pl-3 pr-1 ${
          rail.hasRail ? 'border-accent/50' : 'border-transparent'
        }`}
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
            <p className="type-caption font-mono text-fg-faint">YOUR RECORD</p>
            <p className="font-mono text-xs text-foreground">
              <span>{row.exchangeKey}</span> · <span>{row.raw.mine.capsule_id ?? row.raw.mine.text ?? '—'}</span>
            </p>
          </div>
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <p className="type-caption font-mono text-fg-faint">THEIR RECORD, AS GIVEN TO YOU</p>
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
      </div>
    </div>
  )
}
