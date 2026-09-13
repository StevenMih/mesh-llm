import { ErrorBoundaryPanel } from '@/lib/error/ErrorBoundaryPanel'
import { normalizeCaughtError } from '@/lib/error/normalize-caught-error'

// `@tanstack/react-router`'s `errorComponent` passes `error: unknown` (a
// thrown value, not necessarily an `Error`); normalized below.
type AppErrorBoundaryProps = { error?: unknown }

export function AppErrorBoundary({ error }: AppErrorBoundaryProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 md:p-10">
      <ErrorBoundaryPanel
        title="App error"
        description="A route failed before the app could finish rendering. Refresh to rebuild the app shell and restore navigation."
        error={normalizeCaughtError(error)}
        scopeLabel="App shell"
      />
    </main>
  )
}

export function NotFoundRoute() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="panel-shell rounded-[var(--radius-lg)] border border-border bg-panel p-6">
        <h1 className="type-display">Route not found</h1>
        <p className="type-body mt-2 max-w-[68ch] text-muted-foreground">The requested app surface does not exist.</p>
      </div>
    </main>
  )
}
