import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from '@tanstack/react-router'
import { AppErrorBoundary, NotFoundRoute } from '@/app/error-boundaries/AppErrorBoundary'
import { FeatureErrorBoundary } from '@/app/error-boundaries/FeatureErrorBoundary'
import { RootLayout } from '@/app/layout/RootLayout'
import { parseDeveloperPlaygroundSearch } from '@/features/developer/playground/developer-playground-tabs'
import { parseLogsLedgerSearch } from '@/features/logs/lib/log-search'
import { parseLogRequestDetailsSearch } from '@/features/logs/lib/log-request-details'
import { LogsFeatureGate } from '@/features/logs/pages/LogsFeatureGate'
import { env } from '@/lib/env'

const enableMeshVizPerfRoute = env.isDevelopment || import.meta.env.VITE_ENABLE_PERF_ROUTE === 'true'

const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: AppErrorBoundary,
  notFoundComponent: NotFoundRoute
})
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  head: () => ({ meta: [{ title: 'MeshLLM - Dashboard' }] }),
  component: lazyRouteComponent(() => import('@/features/network/pages/DashboardPage'), 'DashboardPageSurface'),
  errorComponent: FeatureErrorBoundary
})
const reservesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reserves',
  head: () => ({ meta: [{ title: 'MeshLLM - Reserves' }] }),
  component: lazyRouteComponent(() => import('@/features/reserves/pages/ReservesPage'), 'ReservesPageContent'),
  errorComponent: FeatureErrorBoundary
})
const LogsLedgerPage = lazyRouteComponent(() => import('@/features/logs/pages/LogsLedgerPage'), 'LogsLedgerPage')
const LogRequestDetailsPage = lazyRouteComponent(
  () => import('@/features/logs/pages/LogRequestDetailsPage'),
  'LogRequestDetailsPage'
)
const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  head: () => ({ meta: [{ title: 'MeshLLM - Logs' }] }),
  validateSearch: parseLogsLedgerSearch,
  component: () => (
    <LogsFeatureGate>
      <LogsLedgerPage />
    </LogsFeatureGate>
  ),
  errorComponent: FeatureErrorBoundary
})
const logRequestDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs/$requestId',
  head: () => ({ meta: [{ title: 'MeshLLM - Request details' }] }),
  validateSearch: parseLogRequestDetailsSearch,
  component: () => (
    <LogsFeatureGate>
      <LogRequestDetailsPage />
    </LogsFeatureGate>
  ),
  errorComponent: FeatureErrorBoundary
})
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  head: () => ({ meta: [{ title: 'MeshLLM - Chat' }] }),
  // `model`: optional pre-selection, e.g. from the Ledger Peers tab's
  // "Route here" action ([mesh-ledger-peers-tab]).
  validateSearch: (search: Record<string, unknown>): { model?: string } => ({
    ...(typeof search['model'] === 'string' ? { model: search['model'] } : {})
  }),
  component: lazyRouteComponent(() => import('@/features/chat/pages/ChatPage'), 'ChatPageRoute'),
  errorComponent: FeatureErrorBoundary
})
const configurationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/configuration',
  head: () => ({ meta: [{ title: 'MeshLLM - Configuration' }] }),
  component: lazyRouteComponent(
    () => import('@/features/configuration/pages/ConfigurationRoutePage'),
    'ConfigurationRoutePage'
  ),
  errorComponent: FeatureErrorBoundary
})
const configurationTabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/configuration/$configurationTab',
  head: () => ({ meta: [{ title: 'MeshLLM - Configuration' }] }),
  component: lazyRouteComponent(
    () => import('@/features/configuration/pages/ConfigurationRoutePage'),
    'ConfigurationRoutePage'
  ),
  errorComponent: FeatureErrorBoundary
})
// [mesh-ledger-b3-paging] -- `focusExchangeKey` drives the Ledger's
// Exchanges tab to jump to the row's page, open its inspector, and
// highlight it (v3 §2a per-row deep link). See
// `/capsules/exchange/$exchangeKey` below, which redirects here with this
// param set -- same legacy-route-redirects-to-canonical-search shape as
// `/logs/$requestId`.
function parseCapsulesSearch(search: Record<string, unknown>): { focusExchangeKey?: string } {
  const value = search['focusExchangeKey']
  return typeof value === 'string' && value.length > 0 ? { focusExchangeKey: value } : {}
}
const capsulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/capsules',
  head: () => ({ meta: [{ title: 'MeshLLM - Accountability' }] }),
  validateSearch: parseCapsulesSearch,
  component: lazyRouteComponent(
    () => import('@/features/capsules/pages/AccountabilityPage'),
    'AccountabilityPageContent'
  ),
  errorComponent: FeatureErrorBoundary
})
const CapsulesExchangeRedirectPage = lazyRouteComponent(
  () => import('@/features/capsules/pages/CapsulesExchangeRedirectPage'),
  'CapsulesExchangeRedirectPage'
)
const capsulesExchangeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/capsules/exchange/$exchangeKey',
  head: () => ({ meta: [{ title: 'MeshLLM - Accountability' }] }),
  component: CapsulesExchangeRedirectPage,
  errorComponent: FeatureErrorBoundary
})
const pluginWebUiRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plugins/$pluginName/$pageId',
  head: () => ({ meta: [{ title: 'MeshLLM - Plugin' }] }),
  component: lazyRouteComponent(() => import('@/features/plugins/web-ui/PluginWebUiRoutePage'), 'PluginWebUiRoutePage'),
  errorComponent: FeatureErrorBoundary
})
const developerPlaygroundRoute = env.isDevelopment
  ? createRoute({
      getParentRoute: () => rootRoute,
      path: '/__playground',
      head: () => ({ meta: [{ title: 'MeshLLM - Developer Playground' }] }),
      validateSearch: parseDeveloperPlaygroundSearch,
      component: lazyRouteComponent(
        () => import('@/features/developer/pages/DeveloperPlaygroundPage'),
        'DeveloperPlaygroundPage'
      )
    })
  : null
const meshVizPerfRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/__meshviz-perf',
  component: lazyRouteComponent(() => import('@/features/network/pages/MeshVizPerfPage'), 'MeshVizPerfPage')
})
export const routeTree = rootRoute.addChildren([
  indexRoute,
  reservesRoute,
  logsRoute,
  logRequestDetailsRoute,
  chatRoute,
  configurationRoute,
  configurationTabRoute,
  capsulesRoute,
  capsulesExchangeRoute,
  pluginWebUiRoute,
  ...(developerPlaygroundRoute ? [developerPlaygroundRoute] : []),
  ...(enableMeshVizPerfRoute ? [meshVizPerfRoute] : [])
])
export const router = createRouter({ routeTree, basepath: env.routerBasePath })
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
