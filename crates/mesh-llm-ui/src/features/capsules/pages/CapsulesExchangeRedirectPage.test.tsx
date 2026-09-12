import '@testing-library/jest-dom/vitest'

import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CapsulesExchangeRedirectPage } from '@/features/capsules/pages/CapsulesExchangeRedirectPage'

function CapsulesSearchProbe() {
  const search = useSearch({ from: '/capsules' })
  return <output aria-label="Capsules search state">{JSON.stringify(search)}</output>
}

function renderRedirectRoute(initialEntry: string) {
  const rootRoute = createRootRoute({ component: Outlet })
  const capsulesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/capsules',
    validateSearch: (search: Record<string, unknown>) => {
      const value = search['focusExchangeKey']
      return typeof value === 'string' && value.length > 0 ? { focusExchangeKey: value } : {}
    },
    component: CapsulesSearchProbe
  })
  const exchangeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/capsules/exchange/$exchangeKey',
    component: CapsulesExchangeRedirectPage
  })
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    routeTree: rootRoute.addChildren([capsulesRoute, exchangeRoute])
  })

  render(<RouterProvider router={router} />)

  return router
}

describe('CapsulesExchangeRedirectPage — v3 §2a per-row deep link', () => {
  it('redirects /capsules/exchange/:key to /capsules?focusExchangeKey=:key', async () => {
    const router = renderRedirectRoute('/capsules/exchange/exch-cle')

    await screen.findByLabelText('Capsules search state')
    await waitFor(() => expect(router.state.location.pathname).toBe('/capsules'))
    expect(router.state.location.search).toEqual({ focusExchangeKey: 'exch-cle' })
  })
})
