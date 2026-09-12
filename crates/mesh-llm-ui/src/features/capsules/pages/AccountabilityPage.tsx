// [mesh-live-tab-pane-proxy] L2: Ledger tab v1 — four sections replacing the
// prior four sub-tabs. The export name stays AccountabilityPageContent so the
// router import (router.tsx line: 'AccountabilityPageContent') needs no change.
//
// [mesh-ledger-b3-paging] -- bridges the `/capsules` route's
// `focusExchangeKey` search param into a plain prop, so `LedgerPageContent`
// itself stays router-free and independently testable without a
// `RouterProvider` (LedgerPage.test.tsx renders it directly).
import { useSearch } from '@tanstack/react-router'
import { LedgerPageContent } from '@/features/capsules/pages/LedgerPage'

export function AccountabilityPageContent() {
  const search = useSearch({ from: '/capsules' })
  return <LedgerPageContent focusExchangeKey={search.focusExchangeKey} />
}
