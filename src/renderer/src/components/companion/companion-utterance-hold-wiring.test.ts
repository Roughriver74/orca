// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCompanionUtteranceHoldWiring } from './companion-utterance-hold-wiring'

afterEach(() => {
  vi.useRealTimers()
})

describe('useCompanionUtteranceHoldWiring', () => {
  it('returns the same object across re-renders that change nothing it depends on', () => {
    const view = renderHook(() => useCompanionUtteranceHoldWiring())
    const first = view.result.current

    // Why this matters: CompanionPanel's mic-meter callback depends on this hook's
    // return value (`useCallback(..., [hold])`), which in turn is a dependency of
    // useAudioCapture's `publishMeter` -> `start` -> `beginDictationSession` ->
    // `restartForNextUtterance` -> the panel's silence-driven end-of-utterance
    // useEffect. A fresh object every render (even with unchanged, individually
    // memoized properties) tears that effect's interval down and recreates it on
    // every meter-driven re-render — fast enough that the interval's callback
    // (the only thing that flushes the offline GigaAM recognizer into a `final`)
    // almost never gets to fire at all.
    act(() => {
      view.rerender()
    })

    expect(view.result.current).toBe(first)
    expect(view.result.current.cancelHoldOnSpeaking).toBe(first.cancelHoldOnSpeaking)
    expect(view.result.current.handleFinalText).toBe(first.handleFinalText)
    expect(view.result.current.clearHold).toBe(first.clearHold)
    expect(view.result.current.depsRef).toBe(first.depsRef)
  })

  it('returns a new object only when isHolding actually changes', () => {
    const view = renderHook(() => useCompanionUtteranceHoldWiring())
    const beforeHold = view.result.current

    act(() => {
      view.result.current.handleFinalText('Сделай коммит и', 0.5)
    })

    expect(view.result.current.isHolding).toBe(true)
    expect(view.result.current).not.toBe(beforeHold)

    const whileHolding = view.result.current
    act(() => {
      view.rerender()
    })
    expect(view.result.current).toBe(whileHolding)
  })
})
