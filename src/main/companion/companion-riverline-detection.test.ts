import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCompanionRiverlineWatcher,
  decideRiverlineRunning,
  RIVERLINE_BUNDLE_ID
} from './companion-riverline-detection'

describe('decideRiverlineRunning', () => {
  it('is true on macOS when the Riverline bundle id is among the running apps', () => {
    expect(decideRiverlineRunning('darwin', ['com.apple.finder', RIVERLINE_BUNDLE_ID])).toBe(true)
  })

  it('is false on macOS when Riverline is not running', () => {
    expect(decideRiverlineRunning('darwin', ['com.apple.finder'])).toBe(false)
  })

  it('is always false off macOS (Linux office machine has no Riverline), regardless of the list', () => {
    expect(decideRiverlineRunning('linux', [RIVERLINE_BUNDLE_ID])).toBe(false)
    expect(decideRiverlineRunning('win32', [])).toBe(false)
  })
})

describe('createCompanionRiverlineWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports the initial state once right away', async () => {
    const listRunningBundleIds = vi.fn(async () => [RIVERLINE_BUNDLE_ID])
    const watcher = createCompanionRiverlineWatcher({
      platform: 'darwin',
      listRunningBundleIds,
      intervalMs: 1000
    })
    const onChange = vi.fn()
    const dispose = watcher.start(onChange)
    await vi.runOnlyPendingTimersAsync()
    expect(onChange).toHaveBeenCalledWith(true)
    dispose()
  })

  it('re-checks periodically and only calls back when the running state flips', async () => {
    let running = false
    const listRunningBundleIds = vi.fn(async () => (running ? [RIVERLINE_BUNDLE_ID] : []))
    const watcher = createCompanionRiverlineWatcher({
      platform: 'darwin',
      listRunningBundleIds,
      intervalMs: 1000
    })
    const onChange = vi.fn()
    const dispose = watcher.start(onChange)
    await vi.runOnlyPendingTimersAsync()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(false)

    // No flip yet: still not running.
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(1)

    running = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenLastCalledWith(true)

    dispose()
  })

  it('stops polling once disposed', async () => {
    const listRunningBundleIds = vi.fn(async () => [])
    const watcher = createCompanionRiverlineWatcher({
      platform: 'darwin',
      listRunningBundleIds,
      intervalMs: 1000
    })
    const dispose = watcher.start(vi.fn())
    await vi.runOnlyPendingTimersAsync()
    dispose()
    listRunningBundleIds.mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(listRunningBundleIds).not.toHaveBeenCalled()
  })
})
