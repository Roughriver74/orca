import { describe, expect, it, vi } from 'vitest'
import {
  COMPANION_PANEL_AUTO_HIDE_DELAY_MS,
  createCompanionPanelAutoHide
} from './companion-panel-auto-hide'

describe('createCompanionPanelAutoHide', () => {
  it('hides after the configured delay once scheduled', () => {
    vi.useFakeTimers()
    const hide = vi.fn()
    const autoHide = createCompanionPanelAutoHide({ hide })

    autoHide.scheduleAfterReply()
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS - 1)
    expect(hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hide).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('cancel clears a pending timer so hide never fires', () => {
    vi.useFakeTimers()
    const hide = vi.fn()
    const autoHide = createCompanionPanelAutoHide({ hide })

    autoHide.scheduleAfterReply()
    autoHide.cancel()
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS * 2)
    expect(hide).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('cancel is a no-op when nothing is pending', () => {
    const hide = vi.fn()
    const autoHide = createCompanionPanelAutoHide({ hide })
    expect(() => autoHide.cancel()).not.toThrow()
  })

  it('scheduling again before the delay elapses replaces the earlier timer (keeps talking resets it)', () => {
    vi.useFakeTimers()
    const hide = vi.fn()
    const autoHide = createCompanionPanelAutoHide({ hide })

    autoHide.scheduleAfterReply()
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS - 1)
    autoHide.scheduleAfterReply()
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS - 1)
    expect(hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hide).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('respects a custom delay', () => {
    vi.useFakeTimers()
    const hide = vi.fn()
    const autoHide = createCompanionPanelAutoHide({ hide, delayMs: 2_000 })

    autoHide.scheduleAfterReply()
    vi.advanceTimersByTime(1_999)
    expect(hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hide).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
