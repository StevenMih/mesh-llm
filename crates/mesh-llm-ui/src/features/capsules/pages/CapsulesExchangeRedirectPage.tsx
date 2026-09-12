// [mesh-ledger-b3-paging] — the per-row deep link (v3 §2a):
// `/capsules/exchange/exch-cle` redirects to the canonical `/capsules` route
// with `focusExchangeKey` set, same shape as `/logs/$requestId` ->
// `/logs?inspectType=request&inspectId=...`. Keeping this a redirect (not a
// standalone page) means the Ledger's own data fetching, tabs, and filters
// never have to exist twice.
import { Navigate, useParams } from '@tanstack/react-router'

export function CapsulesExchangeRedirectPage() {
  const { exchangeKey } = useParams({ from: '/capsules/exchange/$exchangeKey' })
  return <Navigate replace search={{ focusExchangeKey: exchangeKey }} to="/capsules" />
}
