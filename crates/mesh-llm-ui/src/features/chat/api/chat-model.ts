import { useCallback, useState } from 'react'
import { APP_STORAGE_KEYS } from '@/features/app-tabs/data'

/** The model chosen in the Chat header, kept across leaving and returning to
 *  the tab (the page itself unmounts). `''` = never chosen (automatic). */
export function readStoredChatModel(storageKey = APP_STORAGE_KEYS.chatModel): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(storageKey) ?? ''
  } catch {
    return ''
  }
}

export function writeStoredChatModel(value: string, storageKey = APP_STORAGE_KEYS.chatModel): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey, value)
  } catch {
    return
  }
}

/** The chosen chat model. `initialModel` (a "Route here" pre-selection)
 *  wins over the stored choice as the starting value; every change is
 *  stored, so the header keeps showing it after a tab switch. */
export function usePersistentChatModel(initialModel?: string, storageKey = APP_STORAGE_KEYS.chatModel) {
  const [model, setModelState] = useState(() => initialModel ?? readStoredChatModel(storageKey))
  const setModel = useCallback(
    (value: string) => {
      setModelState(value)
      writeStoredChatModel(value, storageKey)
    },
    [storageKey]
  )
  return { model, setModel }
}
