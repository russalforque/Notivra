import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ConflictError, toUserMessage } from '../lib/errors'
import { clearSaveState, reportSaveState, type SaveState } from '../services/saveStatus'

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000]

export interface AutosaveApi<T> {
  /** Queue a value to be saved after the debounce delay. */
  schedule: (value: T) => void
  /** Save any pending value immediately. Resolves when the latest value is stored (or failed). */
  flush: () => Promise<void>
  retry: () => void
  /** Drop the pending value (used after the user chooses to reload a conflicting version). */
  discard: () => void
  status: SaveState
  error: string | null
  /** True when the last failure was a revision conflict (auto-retry is pointless). */
  conflict: boolean
}

/**
 * Debounced, retrying autosave.
 *
 * Guarantees:
 * - Saves are strictly serialized through one drain loop (never two writes in flight).
 * - The latest scheduled value is never dropped: on failure it stays pending and is retried
 *   with backoff (except conflicts, which need the user to decide).
 * - Pending work is flushed when the page is hidden (tab switch, Android backgrounding) and
 *   when the component unmounts.
 */
export function useAutosave<T>(save: (value: T) => Promise<void>, delayMs = 600): AutosaveApi<T> {
  const sourceId = useId()
  const saveRef = useRef(save)
  const pending = useRef<{ value: T } | null>(null)
  const draining = useRef<Promise<void> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const blockedByConflict = useRef(false)
  const [status, setStatus] = useState<SaveState>('saved')
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  useEffect(() => {
    saveRef.current = save
  }, [save])

  const update = useCallback(
    (state: SaveState, message: string | null = null) => {
      setStatus(state)
      setError(message)
      reportSaveState(sourceId, state, message)
    },
    [sourceId],
  )

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const drain = useCallback(function drainQueue(): Promise<void> {
    clearTimer()
    if (draining.current) return draining.current
    if (!pending.current || blockedByConflict.current) return Promise.resolve()

    const loop = (async () => {
      while (pending.current) {
        const job = pending.current
        update('saving')
        try {
          await saveRef.current(job.value)
          attempts.current = 0
          if (pending.current === job) pending.current = null
        } catch (err) {
          const isConflict = err instanceof ConflictError
          blockedByConflict.current = isConflict
          setConflict(isConflict)
          update('error', toUserMessage(err, 'Could not save your changes. They are kept on screen and will be retried.'))
          if (!isConflict) {
            const delay = RETRY_DELAYS_MS[Math.min(attempts.current, RETRY_DELAYS_MS.length - 1)]!
            attempts.current++
            timer.current = setTimeout(() => void drainQueue(), delay)
          }
          return
        }
      }
      setConflict(false)
      update('saved')
    })()

    draining.current = loop.finally(() => {
      draining.current = null
    })
    return draining.current
  }, [update])

  const schedule = useCallback(
    (value: T) => {
      pending.current = { value }
      if (!blockedByConflict.current) update('unsaved')
      clearTimer()
      timer.current = setTimeout(() => void drain(), delayMs)
    },
    [delayMs, drain, update],
  )

  const flush = useCallback(async () => {
    await drain()
    // A value may have been scheduled while the previous loop was finishing.
    if (pending.current && !blockedByConflict.current && !timer.current) await drain()
  }, [drain])

  const retry = useCallback(() => {
    attempts.current = 0
    blockedByConflict.current = false
    void drain()
  }, [drain])

  const discard = useCallback(() => {
    clearTimer()
    pending.current = null
    blockedByConflict.current = false
    attempts.current = 0
    setConflict(false)
    update('saved')
  }, [update])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void drain()
    }
    const onPageHide = () => void drain()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      // Final flush on unmount; the IndexedDB write completes even after the component is gone.
      void drain().finally(() => {
        if (!pending.current) clearSaveState(sourceId)
      })
    }
  }, [drain, sourceId])

  return { schedule, flush, retry, discard, status, error, conflict }
}
