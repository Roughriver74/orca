import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const {
  handleMock,
  removeHandlerMock,
  hideCompanionPanelMock,
  sendToCompanionWindowMock,
  toggleCompanionConversationMock,
  setCompanionIndicatorInteractiveMock
} = vi.hoisted(() => ({
  handleMock: vi.fn<(channel: string, listener: Handler) => void>(),
  removeHandlerMock: vi.fn(),
  hideCompanionPanelMock: vi.fn(),
  sendToCompanionWindowMock: vi.fn(),
  toggleCompanionConversationMock: vi.fn(),
  setCompanionIndicatorInteractiveMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))

vi.mock('../window/companion-window', () => ({
  hideCompanionPanel: hideCompanionPanelMock,
  sendToCompanionWindow: sendToCompanionWindowMock
}))

vi.mock('../window/companion-indicator-window', () => ({
  setCompanionIndicatorInteractive: setCompanionIndicatorInteractiveMock
}))

vi.mock('../companion/companion-shortcut', () => ({
  getCompanionHotkeyStatus: vi.fn(() => ({ registered: true, hotkey: 'Alt+Space', error: null })),
  toggleCompanionConversation: toggleCompanionConversationMock
}))

// Why mocked: `handleCompanionNoticeAction` pulls in the agent-hook watcher stack,
// unrelated to the IPC wiring this file tests.
vi.mock('../companion/companion-agent-watch', () => ({ handleCompanionNoticeAction: vi.fn() }))

vi.mock('../companion/companion-dialogue', () => ({ companionDialogueHandle: { current: null } }))

import { registerCompanionHandlers } from './companion'
import { companionConversation } from '../companion/companion-conversation'
import { companionDialogueHandle } from '../companion/companion-dialogue'
import { getDefaultCompanionSettings } from '../../shared/constants'

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((entry) => entry[0] === channel)
  if (!call) {
    throw new Error(`${channel} handler not registered`)
  }
  return call[1]
}

function makeStore(companion = getDefaultCompanionSettings()) {
  return { getSettings: () => ({ companion }) }
}

describe('registerCompanionHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    hideCompanionPanelMock.mockReset()
    sendToCompanionWindowMock.mockReset()
    toggleCompanionConversationMock.mockReset()
    setCompanionIndicatorInteractiveMock.mockReset()
    companionDialogueHandle.current = null
    companionConversation.stop()
  })

  it('returns normalized companion settings', () => {
    registerCompanionHandlers(makeStore({ ...getDefaultCompanionSettings(), hotkey: '' }))
    const result = getHandler('companion:getSettings')({})
    expect(result).toEqual(getDefaultCompanionSettings())
  })

  it('delegates toggle to toggleCompanionConversation', () => {
    registerCompanionHandlers(makeStore())
    getHandler('companion:toggle')({})
    expect(toggleCompanionConversationMock).toHaveBeenCalledTimes(1)
  })

  it('reports a non-stop utterance without hiding the panel', () => {
    registerCompanionHandlers(makeStore())
    companionConversation.start()
    const result = getHandler('companion:reportUtterance')({}, 'какая сегодня погода')
    expect(result).toEqual({ stopped: false })
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
  })

  it('reports a stop-phrase utterance and hides the panel', () => {
    registerCompanionHandlers(makeStore())
    companionConversation.start()
    const result = getHandler('companion:reportUtterance')({}, 'Стоп.')
    expect(result).toEqual({ stopped: true })
    expect(hideCompanionPanelMock).toHaveBeenCalledTimes(1)
    expect(companionConversation.getState()).toBe('idle')
  })

  it('ignores a malformed utterance payload', () => {
    registerCompanionHandlers(makeStore())
    expect(getHandler('companion:reportUtterance')({}, 42)).toEqual({ stopped: false })
    expect(getHandler('companion:reportUtterance')({}, '   ')).toEqual({ stopped: false })
  })

  it('hide stops the conversation and hides the panel', () => {
    registerCompanionHandlers(makeStore())
    companionConversation.start()
    expect(getHandler('companion:hide')({})).toEqual({ keepListening: false })
    expect(companionConversation.getState()).toBe('idle')
    expect(hideCompanionPanelMock).toHaveBeenCalledTimes(1)
  })

  it('resetConversation drops the active dialogue session and notifies the panel', () => {
    registerCompanionHandlers(makeStore())
    const resetConversation = vi.fn()
    companionDialogueHandle.current = {
      bargeIn: vi.fn(),
      reportVoiceActivity: vi.fn(() => false),
      hasConfirmedRealSpeech: vi.fn(() => false),
      resetConversation,
      speakAnnouncement: vi.fn(),
      dispose: vi.fn()
    }
    getHandler('companion:resetConversation')({})
    expect(resetConversation).toHaveBeenCalledTimes(1)
    expect(sendToCompanionWindowMock).toHaveBeenCalledWith('companion:conversationReset')
  })

  it('resetConversation is a safe no-op with no active dialogue', () => {
    registerCompanionHandlers(makeStore())
    expect(() => getHandler('companion:resetConversation')({})).not.toThrow()
    expect(sendToCompanionWindowMock).toHaveBeenCalledWith('companion:conversationReset')
  })

  it('voiceActivity forwards a valid frame to the dialogue and reports whether it barged in', () => {
    registerCompanionHandlers(makeStore())
    const reportVoiceActivity = vi.fn(() => true)
    companionDialogueHandle.current = {
      bargeIn: vi.fn(),
      reportVoiceActivity,
      hasConfirmedRealSpeech: vi.fn(() => false),
      resetConversation: vi.fn(),
      speakAnnouncement: vi.fn(),
      dispose: vi.fn()
    }
    const frame = { micLevel: 0.3, playbackLevel: 0.1, durationMs: 43 }
    expect(getHandler('companion:voiceActivity')({}, frame)).toEqual({ bargedIn: true })
    expect(reportVoiceActivity).toHaveBeenCalledWith(frame)
  })

  it('voiceActivity drops a malformed frame without reaching the dialogue', () => {
    registerCompanionHandlers(makeStore())
    const reportVoiceActivity = vi.fn(() => true)
    companionDialogueHandle.current = {
      bargeIn: vi.fn(),
      reportVoiceActivity,
      hasConfirmedRealSpeech: vi.fn(() => false),
      resetConversation: vi.fn(),
      speakAnnouncement: vi.fn(),
      dispose: vi.fn()
    }
    expect(getHandler('companion:voiceActivity')({}, { micLevel: 'loud' })).toEqual({
      bargedIn: false
    })
    expect(reportVoiceActivity).not.toHaveBeenCalled()
  })

  it('indicatorHoverChanged forwards a boolean hover state to the pill window', () => {
    registerCompanionHandlers(makeStore())
    getHandler('companion:indicatorHoverChanged')({}, true)
    expect(setCompanionIndicatorInteractiveMock).toHaveBeenCalledWith(true)

    getHandler('companion:indicatorHoverChanged')({}, 'nope')
    expect(setCompanionIndicatorInteractiveMock).toHaveBeenCalledTimes(1)
  })
})
