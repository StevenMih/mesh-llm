// One config field for the Ledger Panes section
// ([mesh-live-tab-pane-proxy], Q2 ruling): the React tab calls the
// capsule-emit-mesh sidecar's own HTTP surface DIRECTLY (loopback, CORS
// allowlisted to this dashboard's origin on the sidecar side) -- never a
// mesh-llm host route. Absent config -> the Panes section hides its data
// views cleanly rather than rendering a broken/spinning tab; it is never
// on by default.
import { useCallback, useEffect, useState } from 'react'

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
}

/** Reads/writes the sidecar base URL, syncing across tabs via `storage`. */
export function useSidecarBaseUrl() {
  const [baseUrl, setBaseUrlState] = useState<string | null>(() => readSidecarBaseUrl())

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SIDECAR_URL_STORAGE_KEY || event.storageArea !== window.localStorage) return
      setBaseUrlState(isNonEmptyString(event.newValue) ? event.newValue : null)
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const setBaseUrl = useCallback((next: string) => {
    const trimmed = next.trim().replace(/\/+$/, '')
    const normalized = isNonEmptyString(trimmed) ? trimmed : null
    writeSidecarBaseUrl(normalized)
    setBaseUrlState(normalized)
  }, [])

  const clearBaseUrl = useCallback(() => {
    writeSidecarBaseUrl(null)
    setBaseUrlState(null)
  }, [])

  return { baseUrl, setBaseUrl, clearBaseUrl }
}
