import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConflictError, StorageQuotaError } from '../lib/errors'
import { hasUnsavedWork } from '../services/saveStatus'
import { useAutosave } from './useAutosave'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => (resolve = r))
  return { promise, resolve }
}

describe('useAutosave', () => {
  it('debounces and saves only the latest value', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<number>(save, 500))
    act(() => {
      result.current.schedule(1)
      result.current.schedule(2)
      result.current.schedule(3)
    })
    expect(result.current.status).toBe('unsaved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(3)
    expect(result.current.status).toBe('saved')
    vi.useRealTimers()
  })

  it('keeps the value and retries after a storage failure', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValueOnce(new StorageQuotaError()).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAutosave<string>(save, 100))
    act(() => result.current.schedule('important'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(result.current.status).toBe('error')
    expect(result.current.error).toMatch(/storage/i)
    expect(hasUnsavedWork()).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100)
    })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('important')
    expect(result.current.status).toBe('saved')
    vi.useRealTimers()
  })

  it('never runs two saves concurrently and saves values scheduled mid-flight', async () => {
    const gate = deferred()
    let concurrent = 0
    let maxConcurrent = 0
    const saved: number[] = []
    const save = vi.fn(async (v: number) => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      if (v === 1) await gate.promise
      saved.push(v)
      concurrent--
    })
    const { result } = renderHook(() => useAutosave<number>(save, 10))
    await act(async () => {
      result.current.schedule(1)
      const first = result.current.flush()
      result.current.schedule(2)
      const second = result.current.flush()
      gate.resolve()
      await first
      await second
      await result.current.flush()
    })
    expect(maxConcurrent).toBe(1)
    expect(saved).toEqual([1, 2])
    expect(result.current.status).toBe('saved')
  })

  it('does not auto-retry conflicts and allows discarding', async () => {
    vi.useFakeTimers()
    const save = vi.fn().mockRejectedValue(new ConflictError())
    const { result } = renderHook(() => useAutosave<number>(save, 10))
    act(() => result.current.schedule(1))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.current.conflict).toBe(true)
    act(() => result.current.discard())
    expect(result.current.status).toBe('saved')
    vi.useRealTimers()
  })
})
