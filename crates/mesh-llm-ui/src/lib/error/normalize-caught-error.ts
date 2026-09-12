/**
 * Route-level error boundaries (`@tanstack/react-router`'s `errorComponent`)
 * receive `error: unknown` -- JS lets `throw` carry any value, not just an
 * `Error` instance. `ErrorBoundaryPanel` only knows how to render a real
 * `Error` (message/stack), so normalize once at the boundary: pass a real
 * `Error` through unchanged, and wrap anything else in one rather than
 * fabricating a message that hides what was actually thrown.
 */
export function normalizeCaughtError(error: unknown): Error | undefined {
  if (error === undefined || error === null) return undefined
  return error instanceof Error ? error : new Error(String(error))
}
