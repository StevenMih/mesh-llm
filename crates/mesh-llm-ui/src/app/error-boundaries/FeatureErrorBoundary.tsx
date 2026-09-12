import { ErrorBoundaryPanel } from '@/lib/error/ErrorBoundaryPanel'
import { normalizeCaughtError } from '@/lib/error/normalize-caught-error'

// `@tanstack/react-router`'s `errorComponent` passes `error: unknown` (a
// thrown value, not necessarily an `Error`); normalized below.
type FeatureErrorBoundaryProps = { error?: unknown }

export function FeatureErrorBoundary({ error }: FeatureErrorBoundaryProps) {
  return (
    <div className="flex min-h-full w-full items-center justify-center p-6 md:p-10">
      <ErrorBoundaryPanel
        title="Something went wrong"
        description="This section failed to render, but the rest of the app can stay available. Refresh the page to retry the route."
        error={normalizeCaughtError(error)}
        scopeLabel="Route section"
        recoveryActionLabel="Refresh route"
      />
    </div>
  )
}
