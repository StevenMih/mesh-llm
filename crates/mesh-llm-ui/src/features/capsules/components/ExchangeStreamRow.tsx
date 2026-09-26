// One row of the two-sided Ledger stream ([mesh-ledger-b2-two-sided-row]).
// v3 §2's anatomy: a role marker (`●` asked / `◐` served -- no rail, L-O), a
// left session rail when this row and the previous one share a session
// (L-N), and the two-sided record itself -- `YOUR RECORD │ THEIR RECORD, AS
// GIVEN TO YOU`. The column labels themselves now live in the sticky header
// above the stream ([mesh-ledger-b3-paging], v3 §2a), not repeated per row.
// [ledger-T4-inline-inspector] v3 §2/§3/§4 -- the row carries its own two
// explicit toggles, `▸/▾ content` and `▸/▾ checks`, right below the summary
// row. There is no modal and no whole-row click target: the two toggles are
// the entire detail surface.
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
  bracketStrip,
  bracketStripText,
  closedPropertyCells,
  deriveRightCellState,
  isAlarmState,
  isAskAction,
  rightCellAction,
  rightCellDetail,
  rightCellStatusLabel,
  rightCellText,
  rowStateMarker
} from '@/features/capsules/lib/exchange-row-state'
import { InfoHover } from '@/features/capsules/components/InfoHover'
import type { RailSegment } from '@/features/capsules/lib/exchange-stream'
import { useRecomputedIdentity, usePeerLedgerRecompute } from '@/features/capsules/lib/recompute-identity'

/** The gated cell text ([ledger-T1-ask-half-action] Do (2)) when an ask
 *  action's row carries no recorded counterparty. This splits by which of two
 *  distinct truths holds -- the old single "nothing to ask yet" implied a
 *  future action the reader can't take and hid which situation they were in:
 *   - a SERVED row: this node served locally, there is no remote counterparty
 *     on the other side to ask at all -> `Local — no other side`;
 *   - an ASKED row: a remote exchange happened but the peer is unknown/
 *     unrecorded (no counterparty identity field exists on the record yet; the
 *     join comes from Pane B, per-peer) -> `Other side: not known`.
 *  Each is a stated fact, never a deficit or a "not yet". */
const NO_OTHER_SIDE_TEXT = 'Local — no other side'
const OTHER_SIDE_NOT_KNOWN_TEXT = 'Other side: not known'

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
  /** Toggle ① -- flips `contentExpanded` for this row (the `▸/▾ content` control). */
  onToggleContent: (row: ExchangeLedgerRow) => void
  /** Toggle ② -- flips `checksExpanded` for this row (the `▸/▾ checks` control). */
  onToggleChecks: (row: ExchangeLedgerRow) => void
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
  onToggleContent,
  onToggleChecks,
  onAction
}: ExchangeStreamRowProps) {
  // Lifted here (not `SecurityChecksView`, which only mounts once `▸
  // checks` is expanded) so a fetch this hook's `.fetch()` triggers can
  // also flip this row's ALWAYS-VISIBLE status badge the moment it
  // resolves, not just the expanded panel's own cells
  // ([mesh-console-evidence-tab-honesty-defects] finding 1). The hook
  // itself is cheap and a no-op until `.fetch()` is called (rules of
  // hooks require it run unconditionally, same as `useRecomputedIdentity`
  // below).
  const theirsRecompute = usePeerLedgerRecompute(row.raw)
  const state = deriveRightCellState(row.raw, theirsRecompute, localRecord)
  const alarm = isAlarmState(state)
  // [ledger-T1-ask-half-action] Do (2): an ask action with no recorded
  // counterparty renders no button at all, with the text branching on WHICH
  // truth holds -- a SERVED row has no remote other side to ask; an ASKED row
  // has one, but it's unknown/unrecorded. Never a single "nothing to ask yet"
  // that hides the difference.
  const gatedByCounterparty = isAskAction(state.kind) && !row.counterparty
  const gatedText = row.roleTag === 'SERVED' ? NO_OTHER_SIDE_TEXT : OTHER_SIDE_NOT_KNOWN_TEXT
  const cellText = gatedByCounterparty ? gatedText : rightCellText(state)
  const action = gatedByCounterparty ? null : rightCellAction(state)
  // Only recompute while the security view is actually open -- the hook
  // itself must always be called (rules of hooks), but its effect no-ops on
  // a `null` record, so collapsed rows never pay for a fetch+verify.
  const identity = useRecomputedIdentity(checksExpanded ? localRecord : null, nodePubKeyPem)
  // [mesh-citing-record-shots-four-defects] D4(b): the glyph draws the
  // EXCHANGE state (both halves held -> ●, one half -> ◐) -- the role is
  // stated in words below, never by glyph. (L-O's served-rows-carry-no-rail
  // rule is unchanged; it lives in `buildRailSegments`.)
  const marker = rowStateMarker(state)
  // The design's bracket strip (double-entry design §7) -- how the state is
  // drawn: `{ yours ● } ⟷ { theirs ● }`. Same state the badge renders.
  const strip = bracketStripText(bracketStrip(row.raw, state))

  return (
    <div className="flex flex-col" id={exchangeRowDomId(row.exchangeKey)}>
      {rail.isSegmentStart && row.sessionId ? (
        <p className="pl-3 pt-2 type-caption font-mono text-fg-faint">session {row.sessionId}</p>
      ) : null}
      <div
        aria-current={highlighted ? 'true' : undefined}
        aria-label={`Exchange ${row.exchangeKey}`}
        className={cn(
          'flex flex-col gap-2 border-l-2 py-3 pl-3 pr-1',
          rail.hasRail ? 'border-accent/50' : 'border-transparent',
          focused && 'ring-1 ring-inset ring-accent/70',
          highlighted && 'bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)]'
        )}
        data-focused={focused ? 'true' : undefined}
        data-highlighted={highlighted ? 'true' : undefined}
        data-right-cell-state={state.kind}
        data-role-tag={row.roleTag}
        role="group"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-dim">
          <span aria-hidden="true">{marker}</span>
          <time className="font-mono tabular-nums" dateTime={row.timestamp ?? undefined}>
            {formatExchangeTimestamp(row.timestamp)}
          </time>
          <span>{roleText(row.roleTag)}</span>
          {row.counterparty ? (
            <span className="font-mono">{row.counterparty}</span>
          ) : (
            <span>counterparty not recorded</span>
          )}
          <span className="ml-auto inline-flex items-center gap-1">
            {/* L-A/L-B: only CONTRADICTED gets alarm styling; every OPEN
               state renders the same neutral 'muted' tone as CLOSED. */}
            <StatusBadge dot={alarm} size="caption" tone={alarm ? 'bad' : 'muted'}>
              {rightCellStatusLabel(state)}
            </StatusBadge>
            {/* Terse state on the face; the fuller story (their half not held,
               ✓ cites your half by digest, the CLOSED property cells) behind
               the (i). */}
            <InfoHover describes={`the ${rightCellStatusLabel(state)} state`} label={rightCellDetail(state)} side="left" />
          </span>
        </div>
        <div className="grid grid-cols-2 gap-0 rounded border border-border-soft">
          <div className="flex flex-col gap-1 border-r border-border-soft px-3 py-2">
            <p className="font-mono text-xs text-foreground">
              <span>{row.exchangeKey}</span> · <span>{row.raw.mine.capsule_id ?? row.raw.mine.text ?? '—'}</span>
            </p>
          </div>
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <p aria-hidden="true" className="font-mono text-[11px] text-fg-faint">
              {strip}
            </p>
            {state.kind === 'closed' ? (
              // D4(d): CLOSED renders per-property cells, not one sentence --
              // each cell restates a fact the gate's own inputs established.
              <div className="flex flex-wrap gap-1" data-closed-property-cells="true">
                {closedPropertyCells(row.raw).map((cell) => (
                  <span
                    className="rounded border border-border-soft px-1.5 py-0.5 font-mono text-[11px] text-fg-dim"
                    key={cell}
                  >
                    {cell}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-fg-dim">{cellText}</p>
            )}
            {action ? (
              <Button
                className="ui-control h-7 w-fit gap-1 rounded-[var(--radius)] px-2 text-[length:var(--density-type-caption)]"
                onClick={() => onAction(row)}
                size="sm"
                type="button"
                variant="outline"
              >
                {action}
              </Button>
            ) : null}
          </div>
        </div>
        {/* [ledger-T4-inline-inspector] v3 §2's row footer: two independent
           disclosure toggles, never a modal. Always present, regardless of
           the right-cell state. */}
        <div className="flex items-center gap-3 text-xs text-fg-dim">
          <button
            aria-expanded={contentExpanded}
            className="ui-control-ghost font-mono"
            onClick={() => onToggleContent(row)}
            type="button"
          >
            {contentExpanded ? '▾ content' : '▸ content'}
          </button>
          <button
            aria-expanded={checksExpanded}
            className="ui-control-ghost font-mono"
            onClick={() => onToggleChecks(row)}
            type="button"
          >
            {checksExpanded ? '▾ checks' : '▸ checks'}
          </button>
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
        {checksExpanded ? (
          <SecurityChecksView
            identity={identity}
            localRecord={localRecord}
            row={row}
            theirsRecompute={theirsRecompute}
          />
        ) : null}
      </div>
    </div>
  )
}
