import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  registerMock,
  unregisterMock,
  showCompanionPanelMock,
  hideCompanionPanelMock,
  sendToCompanionWindowMock,
  ensureCompanionWindowAliveMock,
  destroyCompanionWindowMock,
  destroyCompanionIndicatorWindowMock,
  setLoginItemSettingsMock,
  isCompanionPanelOpenMock,
  wakeMode
} = vi.hoisted(() => ({
  isCompanionPanelOpenMock: vi.fn(() => false),
  wakeMode: {
    enabled: false,
    addressCompanion: vi.fn(),
    dismissCompanionAddress: vi.fn()
  },
  registerMock: vi.fn((_accelerator: string, _callback: () => void) => true),
  unregisterMock: vi.fn(),
  showCompanionPanelMock: vi.fn(),
  hideCompanionPanelMock: vi.fn(),
  sendToCompanionWindowMock: vi.fn(),
  ensureCompanionWindowAliveMock: vi.fn(),
  destroyCompanionWindowMock: vi.fn(),
  destroyCompanionIndicatorWindowMock: vi.fn(),
  setLoginItemSettingsMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: { setLoginItemSettings: setLoginItemSettingsMock },
  globalShortcut: { register: registerMock, unregister: unregisterMock }
}))

vi.mock('../window/companion-window', () => ({
  showCompanionPanel: showCompanionPanelMock,
  hideCompanionPanel: hideCompanionPanelMock,
  sendToCompanionWindow: sendToCompanionWindowMock,
  ensureCompanionWindowAlive: ensureCompanionWindowAliveMock,
  destroyCompanionWindow: destroyCompanionWindowMock,
  isCompanionPanelOpen: isCompanionPanelOpenMock
}))

vi.mock('../window/companion-indicator-window', () => ({
  destroyCompanionIndicatorWindow: destroyCompanionIndicatorWindowMock
}))

vi.mock('./companion-wake-listening', () => ({
  isCompanionWakeListeningEnabled: () => wakeMode.enabled,
  addressCompanion: wakeMode.addressCompanion,
  dismissCompanionAddress: wakeMode.dismissCompanionAddress
}))

// Why mocked: this test drives the hotkey callback directly, not a real dialogue
// orchestrator; `companionDialogueHandle.current` is reassigned per test to a fake with a
// `bargeIn` spy, exercising the handle wiring without the real brain/TTS stack.
vi.mock('./companion-dialogue', () => ({ companionDialogueHandle: { current: null } }))

import { getCompanionHotkeyStatus, initCompanionHotkey } from './companion-shortcut'
import { companionConversation } from './companion-conversation'
import { companionDialogueHandle } from './companion-dialogue'
import { getDefaultCompanionSettings } from '../../shared/constants'

type Listener = (updates: Record<string, unknown>) => void

function makeStore(companion = getDefaultCompanionSettings()) {
  let settings = { companion }
  let listener: Listener | null = null
  return {
    getSettings: () => settings,
    onSettingsChanged: (fn: Listener) => {
      listener = fn
      return vi.fn()
    },
    setCompanion: (next: typeof companion) => {
      settings = { companion: next }
      listener?.({ companion: next })
    },
    notifyUnrelatedChange: () => {
      listener?.({ theme: 'dark' })
    }
  }
}

describe('companion hotkey', () => {
  beforeEach(() => {
    registerMock.mockReset().mockReturnValue(true)
    unregisterMock.mockReset()
    showCompanionPanelMock.mockReset()
    hideCompanionPanelMock.mockReset()
    sendToCompanionWindowMock.mockReset()
    ensureCompanionWindowAliveMock.mockReset()
    destroyCompanionWindowMock.mockReset()
    destroyCompanionIndicatorWindowMock.mockReset()
    isCompanionPanelOpenMock.mockReset().mockReturnValue(false)
    wakeMode.enabled = false
    wakeMode.addressCompanion.mockClear()
    wakeMode.dismissCompanionAddress.mockClear()
    setLoginItemSettingsMock.mockReset()
    companionDialogueHandle.current = null
    companionConversation.stop()
  })

  it('does not register a hotkey when companion is disabled', () => {
    const store = makeStore()
    initCompanionHotkey(store)
    expect(registerMock).not.toHaveBeenCalled()
    expect(getCompanionHotkeyStatus()).toEqual({ registered: false, hotkey: null, error: null })
    expect(destroyCompanionWindowMock).toHaveBeenCalledTimes(1)
    expect(destroyCompanionIndicatorWindowMock).toHaveBeenCalledTimes(1)
    expect(ensureCompanionWindowAliveMock).not.toHaveBeenCalled()
  })

  it('registers the configured hotkey when enabled and keeps the window alive', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    expect(registerMock).toHaveBeenCalledWith('Alt+Space', expect.any(Function))
    expect(ensureCompanionWindowAliveMock).toHaveBeenCalledTimes(1)
    expect(getCompanionHotkeyStatus()).toEqual({
      registered: true,
      hotkey: 'Alt+Space',
      error: null
    })
  })

  it('surfaces a registration failure instead of throwing', () => {
    registerMock.mockReturnValue(false)
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Cmd+Space'
    })
    initCompanionHotkey(store)
    const status = getCompanionHotkeyStatus()
    expect(status.registered).toBe(false)
    expect(status.error).toContain('Cmd+Space')
  })

  it('re-registers the new accelerator when the hotkey setting changes', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    expect(registerMock).toHaveBeenCalledWith('Alt+Space', expect.any(Function))

    store.setCompanion({ ...getDefaultCompanionSettings(), enabled: true, hotkey: 'Control+J' })

    expect(unregisterMock).toHaveBeenCalledWith('Alt+Space')
    expect(registerMock).toHaveBeenCalledWith('Control+J', expect.any(Function))
    expect(getCompanionHotkeyStatus().hotkey).toBe('Control+J')
  })

  it('unregisters the hotkey when companion is disabled via a settings update', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    store.setCompanion({ ...getDefaultCompanionSettings(), enabled: false })
    expect(unregisterMock).toHaveBeenCalledWith('Alt+Space')
    expect(getCompanionHotkeyStatus()).toEqual({ registered: false, hotkey: null, error: null })
    expect(destroyCompanionWindowMock).toHaveBeenCalled()
  })

  it('ignores settings changes unrelated to companion', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    registerMock.mockClear()
    unregisterMock.mockClear()
    // Why: onSettingsChanged in production fires for every update; the listener
    // must early-return for updates that don't touch `companion`.
    store.notifyUnrelatedChange()
    expect(registerMock).not.toHaveBeenCalled()
    expect(unregisterMock).not.toHaveBeenCalled()
  })

  it('the disposer unregisters the hotkey', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    const dispose = initCompanionHotkey(store)
    dispose()
    expect(unregisterMock).toHaveBeenCalledWith('Alt+Space')
    expect(getCompanionHotkeyStatus().registered).toBe(false)
  })

  it('toggling the hotkey callback opens then closes the conversation', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    const callback = registerMock.mock.calls[0]?.[1]
    if (!callback) {
      throw new Error('hotkey callback was not registered')
    }

    callback()
    expect(companionConversation.getState()).toBe('listening')
    expect(showCompanionPanelMock).toHaveBeenCalledTimes(1)
    expect(sendToCompanionWindowMock).toHaveBeenCalledWith('companion:conversationOpened')

    callback()
    expect(companionConversation.getState()).toBe('idle')
    expect(hideCompanionPanelMock).toHaveBeenCalledTimes(1)
    expect(sendToCompanionWindowMock).toHaveBeenCalledWith('companion:conversationClosed')
  })

  it('in wake mode the hotkey shows/hides the panel but never stops background listening', () => {
    wakeMode.enabled = true
    const store = makeStore({ ...getDefaultCompanionSettings(), enabled: true })
    initCompanionHotkey(store)
    const callback = registerMock.mock.calls[0]?.[1]
    if (!callback) {
      throw new Error('hotkey callback was not registered')
    }
    companionConversation.start()

    isCompanionPanelOpenMock.mockReturnValue(false)
    callback()
    expect(showCompanionPanelMock).toHaveBeenCalledTimes(1)
    expect(wakeMode.addressCompanion).toHaveBeenCalledTimes(1)

    isCompanionPanelOpenMock.mockReturnValue(true)
    callback()
    expect(hideCompanionPanelMock).toHaveBeenCalledTimes(1)
    expect(wakeMode.dismissCompanionAddress).toHaveBeenCalledTimes(1)
    expect(companionConversation.getState()).toBe('listening')
    expect(sendToCompanionWindowMock).not.toHaveBeenCalledWith('companion:conversationClosed')

    wakeMode.enabled = false
    companionConversation.stop()
  })

  it('hotkey pressed while speaking barges in instead of closing the conversation', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    const callback = registerMock.mock.calls[0]?.[1]
    if (!callback) {
      throw new Error('hotkey callback was not registered')
    }
    const bargeIn = vi.fn()
    companionConversation.start()
    companionConversation.reportThinking()
    companionConversation.reportSpeaking()
    companionDialogueHandle.current = {
      bargeIn,
      reportVoiceActivity: vi.fn(() => false),
      hasConfirmedRealSpeech: vi.fn(() => false),
      resetConversation: vi.fn(),
      dispose: vi.fn()
    }

    callback()

    expect(bargeIn).toHaveBeenCalledTimes(1)
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
    expect(sendToCompanionWindowMock).not.toHaveBeenCalledWith('companion:conversationClosed')
  })

  it('hotkey pressed while speaking is a safe no-op with no active dialogue', () => {
    const store = makeStore({
      ...getDefaultCompanionSettings(),
      enabled: true,
      hotkey: 'Alt+Space'
    })
    initCompanionHotkey(store)
    const callback = registerMock.mock.calls[0]?.[1]
    if (!callback) {
      throw new Error('hotkey callback was not registered')
    }
    companionConversation.start()
    companionConversation.reportThinking()
    companionConversation.reportSpeaking()

    expect(() => callback()).not.toThrow()
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
  })

  it('sets the macOS login item from enabled + launchAtLogin', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const store = makeStore({
        ...getDefaultCompanionSettings(),
        enabled: true,
        hotkey: 'Alt+Space',
        launchAtLogin: true
      })
      initCompanionHotkey(store)
      expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })

      store.setCompanion({ ...getDefaultCompanionSettings(), enabled: true, launchAtLogin: false })
      expect(setLoginItemSettingsMock).toHaveBeenLastCalledWith({ openAtLogin: false })

      store.setCompanion({ ...getDefaultCompanionSettings(), enabled: false, launchAtLogin: true })
      expect(setLoginItemSettingsMock).toHaveBeenLastCalledWith({ openAtLogin: false })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })
})
