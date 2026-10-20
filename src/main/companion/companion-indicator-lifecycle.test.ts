import { describe, expect, it, vi } from 'vitest'
import {
  decideCompanionIndicatorVisible,
  initCompanionIndicator
} from './companion-indicator-lifecycle'

describe('decideCompanionIndicatorVisible', () => {
  it('is hidden while idle, even if Riverline is not running', () => {
    expect(decideCompanionIndicatorVisible({ riverlineRunning: false, state: 'idle' })).toBe(false)
  })

  it.each(['listening', 'thinking', 'speaking'] as const)(
    'is shown while %s, as long as Riverline is not running',
    (state) => {
      expect(decideCompanionIndicatorVisible({ riverlineRunning: false, state })).toBe(true)
    }
  )

  it.each(['listening', 'thinking', 'speaking'] as const)(
    'stays hidden while %s if Riverline is already showing the same state',
    (state) => {
      expect(decideCompanionIndicatorVisible({ riverlineRunning: true, state })).toBe(false)
    }
  )
})

const {
  showCompanionIndicatorMock,
  hideCompanionIndicatorMock,
  sendToCompanionIndicatorWindowMock
} = vi.hoisted(() => ({
  showCompanionIndicatorMock: vi.fn(),
  hideCompanionIndicatorMock: vi.fn(),
  sendToCompanionIndicatorWindowMock: vi.fn()
}))

vi.mock('../window/companion-indicator-window', () => ({
  showCompanionIndicator: showCompanionIndicatorMock,
  hideCompanionIndicator: hideCompanionIndicatorMock,
  sendToCompanionIndicatorWindow: sendToCompanionIndicatorWindowMock
}))

const { startMock, riverlineOnChange } = vi.hoisted(() => {
  let onChange: ((running: boolean) => void) | null = null
  return {
    riverlineOnChange: {
      invoke: (running: boolean) => onChange?.(running)
    },
    startMock: vi.fn((cb: (running: boolean) => void) => {
      onChange = cb
      return vi.fn()
    })
  }
})

vi.mock('./companion-riverline-detection', () => ({
  createCompanionRiverlineWatcher: () => ({ start: startMock })
}))

import { companionConversation } from './companion-conversation'

describe('initCompanionIndicator', () => {
  it('shows the pill once the conversation becomes active (Riverline not running)', () => {
    companionConversation.stop()
    showCompanionIndicatorMock.mockClear()
    hideCompanionIndicatorMock.mockClear()
    const dispose = initCompanionIndicator()
    riverlineOnChange.invoke(false)

    companionConversation.start()
    expect(showCompanionIndicatorMock).toHaveBeenCalled()
    expect(sendToCompanionIndicatorWindowMock).toHaveBeenLastCalledWith(
      'companion:stateChanged',
      'listening'
    )

    companionConversation.stop()
    expect(hideCompanionIndicatorMock).toHaveBeenCalled()
    dispose()
  })

  it('hides the pill once Riverline starts running, even mid-conversation', () => {
    companionConversation.stop()
    const dispose = initCompanionIndicator()
    riverlineOnChange.invoke(false)
    companionConversation.start()
    showCompanionIndicatorMock.mockClear()
    hideCompanionIndicatorMock.mockClear()

    riverlineOnChange.invoke(true)
    expect(hideCompanionIndicatorMock).toHaveBeenCalled()
    expect(showCompanionIndicatorMock).not.toHaveBeenCalled()

    companionConversation.stop()
    dispose()
  })
})
