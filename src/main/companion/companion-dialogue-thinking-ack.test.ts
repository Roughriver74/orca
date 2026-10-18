import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COMPANION_THINKING_ACK_PHRASES,
  pickCompanionThinkingAckPhrase,
  scheduleCompanionThinkingAck
} from './companion-dialogue-thinking-ack'

afterEach(() => {
  vi.useRealTimers()
})

describe('pickCompanionThinkingAckPhrase', () => {
  it('always returns one of the fixed cacheable phrases', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(COMPANION_THINKING_ACK_PHRASES).toContain(pickCompanionThinkingAckPhrase())
    }
  })
})

describe('scheduleCompanionThinkingAck', () => {
  it('speaks the phrase once the delay elapses with nothing cancelling it first', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    scheduleCompanionThinkingAck({ speak, isCurrent: () => true, delayMs: 1200 })

    vi.advanceTimersByTime(1199)
    expect(speak).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('never speaks once onDelta() has run, even after the delay', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    const ack = scheduleCompanionThinkingAck({ speak, isCurrent: () => true, delayMs: 1000 })

    ack.onDelta()
    vi.advanceTimersByTime(5000)

    expect(speak).not.toHaveBeenCalled()
  })

  it('onToolStart() speaks immediately, skipping the delay, and only once', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    const ack = scheduleCompanionThinkingAck({ speak, isCurrent: () => true, delayMs: 5000 })

    ack.onToolStart()
    expect(speak).toHaveBeenCalledTimes(1)

    ack.onToolStart()
    vi.advanceTimersByTime(5000)
    expect(speak).toHaveBeenCalledTimes(1)
  })

  it('dispose() cancels a pending delay timer', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    const ack = scheduleCompanionThinkingAck({ speak, isCurrent: () => true, delayMs: 1000 })

    ack.dispose()
    vi.advanceTimersByTime(5000)

    expect(speak).not.toHaveBeenCalled()
  })

  it('the delay timer no-ops once the turn is no longer current', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    let current = true
    scheduleCompanionThinkingAck({ speak, isCurrent: () => current, delayMs: 1000 })

    current = false
    vi.advanceTimersByTime(1000)

    expect(speak).not.toHaveBeenCalled()
  })

  it('uses the injected pickPhrase for the spoken text', () => {
    vi.useFakeTimers()
    const speak = vi.fn()
    const ack = scheduleCompanionThinkingAck({
      speak,
      isCurrent: () => true,
      pickPhrase: () => 'Тестовая фраза',
      delayMs: 1000
    })

    ack.onToolStart()

    expect(speak).toHaveBeenCalledWith('Тестовая фраза')
  })
})
