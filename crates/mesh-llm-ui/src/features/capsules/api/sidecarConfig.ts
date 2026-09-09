// One config field for the Ledger Panes section
// ([mesh-live-tab-pane-proxy], Q2 ruling): the React tab calls the
// capsule-emit-mesh sidecar's own HTTP surface DIRECTLY (loopback, CORS
// allowlisted to this dashboard's origin on the sidecar side) -- never a
// mesh-llm host route. Absent config -> the Panes section hides its data
// views cleanly rather than rendering a broken/spinning tab; it is never
// on by default.
import { useCallback, useSyncExternalStore } from 'react'

export const SIDECAR_URL_STORAGE_KEY = 'mesh-llm.accountability.sidecarBaseUrl'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function readSidecarBaseUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(SIDECAR_URL_STORAGE_KEY)
    return isNonEmptyString(stored) ? stored.trim().replace(/\/+$/, '') : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Module-level store — one shared value, subscriber set notified by both
// writeSidecarBaseUrl() and the cross-tab `storage` event. This means every
// call to useSidecarBaseUrl() (including the two in SidecarPanesSection +
// SidecarUrlField) shares one in-document state and all update together on
// the same write — no reload required.
// ---------------------------------------------------------------------------

let _currentBaseUrl: string | null = readSidecarBaseUrl()
const _subscribers = new Set<() => void>()

function _notify() {
  for (const cb of _subscribers) cb()
}

function _subscribe(cb: () => void): () => void {
  _subscribers.add(cb)
  // Cross-tab sync via the `storage` event (fires in OTHER documents, not the
  // writer — the in-document path is covered by writeSidecarBaseUrl below).
  function handleStorage(event: StorageEvent) {
    if (event.key !== SIDECAR_URL_STORAGE_KEY || event.storageArea !== window.localStorage) return
    _currentBaseUrl = isNonEmptyString(event.newValue) ? event.newValue : null
    _notify()
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    _subscribers.delete(cb)
    window.removeEventListener('storage', handleStorage)
  }
}

function _getSnapshot(): string | null {
  return _currentBaseUrl
}

function writeSidecarBaseUrl(url: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (url === null) {
      window.localStorage.removeItem(SIDECAR_URL_STORAGE_KEY)
    } else {
      window.localStorage.setItem(SIDECAR_URL_STORAGE_KEY, url)
    }
  } catch {
    // A private-browsing / storage-disabled context degrades to "not
    // configured this session" rather than throwing.
  }
  // Update module store and notify ALL subscribers in this document
  // immediately (the `storage` event never fires in the originating document).
  _currentBaseUrl = url
  _notify()
}

/** Reads/writes the sidecar base URL, syncing across tabs via `storage` and
 *  across all hook instances in the same document via a module-level store.
 *  Every call to this hook shares a single snapshot; a Save in SidecarUrlField
 *  updates SidecarPanesSection's baseUrl in the same render cycle. */
export function useSidecarBaseUrl() {
  const baseUrl = useSyncExternalStore(_subscribe, _getSnapshot, () => null)

  const setBaseUrl = useCallback((next: string) => {
    const trimmed = next.trim().replace(/\/+$/, '')
    const normalized = isNonEmptyString(trimmed) ? trimmed : null
    writeSidecarBaseUrl(normalized)
  }, [])

  const clearBaseUrl = useCallback(() => {
    writeSidecarBaseUrl(null)
  }, [])

  return { baseUrl, setBaseUrl, clearBaseUrl }
}

// Exported for tests that need to reset module-level state between runs.
export function _resetSidecarStoreForTest(): void {
  _currentBaseUrl = null
  _subscribers.clear()
}
