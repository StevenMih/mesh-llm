// [ledger-T5-join-key] The Ledger's exchange_id column cell: the short id
// plus an "open in Logs" affordance, split into its own file so the column
// definitions module (`ExchangeColumns.tsx`) stays a components-only export
// boundary for fast refresh.
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'

/** A digest-keyed grouping fallback (`exchange_key_for`, host side) is not a
 *  real exchange join-key -- `open in Logs` must never link on one, since no
 *  Logs row can ever carry a `digest:` value as its `exchangeId`. */
function isRealExchangeId(exchangeKey: string): boolean {
  return !exchangeKey.startsWith('digest:')
}

/** u109: "see in Logs" from an exchange row. Logs opens the request that
 *  carries this exchange id (`focusExchangeId`); nothing shows for a
 *  digest-keyed row, which no Logs request can carry. */
export function SeeInLogsLink({ exchangeKey }: { exchangeKey: string }) {
  const navigate = useNavigate()
  if (!isRealExchangeId(exchangeKey)) return null
  return (
    <button
      className="ui-control-ghost inline-flex items-center gap-0.5 rounded-[var(--radius)] px-1 text-fg-dim hover:text-foreground"
      data-see-in-logs="true"
      onClick={(event) => {
        event.stopPropagation()
        navigate({ search: { focusExchangeId: exchangeKey }, to: '/logs' })
      }}
      type="button"
    >
      see in Logs
      <ArrowUpRight aria-hidden="true" className="size-3" />
    </button>
  )
}

export function ExchangeIdCell({ exchangeKey }: { exchangeKey: string }) {
  const navigate = useNavigate()
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-foreground" title={exchangeKey}>
        {exchangeKey.slice(0, 8)}
      </span>
      {isRealExchangeId(exchangeKey) ? (
        <button
          aria-label={`Open exchange ${exchangeKey} in Logs`}
          className="ui-control-ghost rounded-[var(--radius)] p-0.5 text-fg-dim hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation()
            navigate({ search: { focusExchangeId: exchangeKey }, to: '/logs' })
          }}
          type="button"
        >
          <ArrowUpRight aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
