import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { CompanionSettings } from '../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../shared/constants'

const {
  hideCompanionPanel,
  isCompanionPanelOpen,
  sendToCompanionWindow,
  showForNotice,
  powerSaveBlockerStart,
  powerSaveBlockerStop,
  powerSaveBlockerIsStarted
} = vi.hoisted(() => ({
  hideCompanionPanel: vi.fn(),
  isCompanionPanelOpen: vi.fn(() => false),
  sendToCompanionWindow: vi.fn(),
  showForNotice: vi.fn(),
  powerSaveBlockerStart: vi.fn(() => 1),
  powerSaveBlockerStop: vi.fn(),
  powerSaveBlockerIsStarted: vi.fn(() => true)
}))

vi.mock('../window/companion-window', () => ({
  hideCompanionPanel,
  isCompanionPanelOpen,
  sendToCompanionWindow,
  showCompanionPanelForNotice: showForNotice
}))

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: powerSaveBlockerStart,
    stop: powerSaveBlockerStop,
    isStarted: powerSaveBlockerIsStarted
  }
}))

import { companionConversation, onCompanionUtterance } from './companion-conversation'
import {
  addressCompanion,
  clearHeldCompanionRequest,
  initCompanionWakeListening,
  isCompanionRequestHeld,
  reportCompanionUserSpeakingForEndKeyword,
  routeCompanionUtterance
} from './companion-wake-listening'

function storeWith(companion: CompanionSettings) {
  let settingsListener: ((updates: Partial<GlobalSettings>) => void) | null = null
  let current = companion
  return {
    getSettings: () => ({ companion: current }),
    onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => {
      settingsListener = listener
      return () => {
        settingsListener = null
      }
    },
    update(next: CompanionSettings) {
      current = next
      settingsListener?.({ companion: next })
    }
  }
}

function wakeSettings(
  enabled: boolean,
  overrides: Partial<CompanionSettings> = {}
): CompanionSettings {
  const defaults = getDefaultCompanionSettings()
  return { ...defaults, enabled: true, wake: { ...defaults.wake, enabled }, ...overrides }
}

describe('companion wake listening', () => {
  let dispose: (() => void) | null = null
  const utterances: string[] = []
  let offUtterance: () => void = () => {}

  beforeEach(() => {
    companionConversation.stop()
    vi.clearAllMocks()
    utterances.length = 0
    offUtterance = onCompanionUtterance((text) => utterances.push(text))
  })

  afterEach(() => {
    dispose?.()
    dispose = null
    offUtterance()
    companionConversation.stop()
  })

  it('starts listening in the background (panel hidden) once wake mode is enabled', () => {
    const store = storeWith(wakeSettings(false))
    dispose = initCompanionWakeListening(store)
    expect(companionConversation.getState()).toBe('idle')

    store.update(wakeSettings(true))

    expect(companionConversation.getState()).toBe('listening')
    expect(sendToCompanionWindow).toHaveBeenCalledWith('companion:conversationOpened')
    expect(showForNotice).not.toHaveBeenCalled()
    // Why: macOS App Nap would otherwise throttle the hidden panel's mic capture once the
    // process has no visible windows and is not frontmost (see companion-wake-listening.ts).
    expect(powerSaveBlockerStart).toHaveBeenCalledWith('prevent-app-suspension')
  })

  it('stops background listening when wake mode is turned off while the panel is hidden', () => {
    const store = storeWith(wakeSettings(true))
    dispose = initCompanionWakeListening(store)
    expect(powerSaveBlockerStart).toHaveBeenCalledWith('prevent-app-suspension')
    store.update(wakeSettings(false))
    expect(companionConversation.getState()).toBe('idle')
    expect(sendToCompanionWindow).toHaveBeenCalledWith('companion:conversationClosed')
    expect(powerSaveBlockerStop).toHaveBeenCalledWith(1)
  })

  it('releases the app-suspension block on dispose', () => {
    const store = storeWith(wakeSettings(true))
    dispose = initCompanionWakeListening(store)
    expect(powerSaveBlockerStart).toHaveBeenCalledWith('prevent-app-suspension')
    dispose()
    dispose = null
    expect(powerSaveBlockerStop).toHaveBeenCalledWith(1)
  })

  it('drops background speech and sends only addressed requests to the brain', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(true)))
    const bargeIn = vi.fn()
    const isRealSpeechConfirmed = vi.fn(() => true)

    expect(
      routeCompanionUtterance('по телевизору прогноз погоды', 0.4, {
        bargeIn,
        isRealSpeechConfirmed
      })
    ).toEqual({
      stopped: false,
      ignored: true
    })
    expect(utterances).toEqual([])

    expect(
      routeCompanionUtterance('Джарвис, какая погода?', 0.4, { bargeIn, isRealSpeechConfirmed })
    ).toEqual({
      stopped: false
    })
    expect(utterances).toEqual(['какая погода?'])
    // Backlog #28: `showPanelOnAddress` defaults off — an addressed request answers by
    // voice without the big panel popping over the user's windows.
    expect(showForNotice).not.toHaveBeenCalled()
    expect(bargeIn).not.toHaveBeenCalled()
  })

  it('shows the big panel on an addressed request only when "Показывать панель при обращении" is on', () => {
    dispose = initCompanionWakeListening(
      storeWith(wakeSettings(true, { showPanelOnAddress: true }))
    )
    routeCompanionUtterance('Джарвис, какая погода?', 0.4, {
      bargeIn: vi.fn(),
      isRealSpeechConfirmed: () => true
    })
    expect(utterances).toEqual(['какая погода?'])
    expect(showForNotice).toHaveBeenCalled()
  })

  it('a bare wake phrase alone never shows the big panel, even with showPanelOnAddress on', () => {
    dispose = initCompanionWakeListening(
      storeWith(wakeSettings(true, { showPanelOnAddress: true }))
    )
    const result = routeCompanionUtterance('Джарвис', 0.4, {
      bargeIn: vi.fn(),
      isRealSpeechConfirmed: () => true
    })
    expect(result).toEqual({ stopped: false })
    expect(utterances).toEqual([])
    expect(showForNotice).not.toHaveBeenCalled()
    // The pill still reflects this — companion-indicator-lifecycle.ts reacts to
    // companionConversation's state directly, which stays 'listening' throughout.
    expect(companionConversation.getState()).toBe('listening')
  })

  it('lets only the name interrupt Jarvis while he speaks', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(true)))
    companionConversation.reportThinking()
    companionConversation.reportSpeaking()
    const bargeIn = vi.fn()
    const isRealSpeechConfirmed = vi.fn(() => true)

    routeCompanionUtterance('реклама из телевизора', 0.4, { bargeIn, isRealSpeechConfirmed })
    expect(bargeIn).not.toHaveBeenCalled()

    routeCompanionUtterance('Джарвис, подожди', 0.4, { bargeIn, isRealSpeechConfirmed })
    expect(bargeIn).toHaveBeenCalledTimes(1)
    expect(utterances).toEqual(['подожди'])
  })

  it('does not let a wake-phrase match alone interrupt Jarvis — it must also be confirmed as real (not his own echo)', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(true)))
    companionConversation.reportThinking()
    companionConversation.reportSpeaking()
    const bargeIn = vi.fn()

    const result = routeCompanionUtterance('Джарвис, подожди', 0.4, {
      bargeIn,
      isRealSpeechConfirmed: () => false
    })

    expect(bargeIn).not.toHaveBeenCalled()
    expect(result).toEqual({ stopped: false, ignored: true })
    expect(utterances).toEqual([])
    expect(companionConversation.getState()).toBe('speaking')
  })

  it('"стоп" ends the exchange but keeps listening for the name', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(true)))
    const result = routeCompanionUtterance('Джарвис, стоп', undefined, {
      bargeIn: vi.fn(),
      isRealSpeechConfirmed: () => true
    })
    expect(result).toEqual({ stopped: false })
    expect(utterances).toEqual([])
    expect(companionConversation.getState()).toBe('listening')
    expect(hideCompanionPanel).toHaveBeenCalled()
  })

  it('treats the hotkey as an address so the next request needs no name', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(true)))
    addressCompanion()
    routeCompanionUtterance('включи свет', undefined, {
      bargeIn: vi.fn(),
      isRealSpeechConfirmed: () => true
    })
    expect(utterances).toEqual(['включи свет'])
  })

  it('keeps the old behaviour with wake mode off: every utterance passes, a stop phrase closes', () => {
    dispose = initCompanionWakeListening(storeWith(wakeSettings(false)))
    companionConversation.start()
    routeCompanionUtterance('просто фраза', undefined, {
      bargeIn: vi.fn(),
      isRealSpeechConfirmed: () => true
    })
    expect(utterances).toEqual(['просто фраза'])

    expect(
      routeCompanionUtterance('стоп', undefined, {
        bargeIn: vi.fn(),
        isRealSpeechConfirmed: () => true
      })
    ).toEqual({
      stopped: true
    })
    expect(companionConversation.getState()).toBe('idle')
    expect(hideCompanionPanel).toHaveBeenCalled()
  })

  describe('with the end keyword ("слово-сигнал") on', () => {
    const actions = { bargeIn: vi.fn(), isRealSpeechConfirmed: () => true }

    function endKeywordSettings(wakeEnabled: boolean): CompanionSettings {
      const defaults = getDefaultCompanionSettings()
      return wakeSettings(wakeEnabled, { endKeyword: { ...defaults.endKeyword, enabled: true } })
    }

    beforeEach(() => {
      vi.useFakeTimers()
      actions.bargeIn.mockClear()
    })

    afterEach(() => {
      clearHeldCompanionRequest()
      vi.useRealTimers()
    })

    it('holds every segment and sends them as one request once the keyword ends it', () => {
      dispose = initCompanionWakeListening(storeWith(endKeywordSettings(false)))
      companionConversation.start()

      expect(routeCompanionUtterance('Хочу, чтобы ты', 0.4, actions)).toEqual({ stopped: false })
      vi.advanceTimersByTime(2000)
      routeCompanionUtterance('посмотрел логи сборки', 0.4, actions)
      expect(utterances).toEqual([])
      expect(isCompanionRequestHeld()).toBe(true)

      routeCompanionUtterance('и нашёл ошибку. Думай.', 0.4, actions)
      expect(utterances).toEqual(['Хочу, чтобы ты посмотрел логи сборки и нашёл ошибку.'])
      expect(isCompanionRequestHeld()).toBe(false)
    })

    it('sends a held request on the fallback pause, but not while the user is still talking', () => {
      dispose = initCompanionWakeListening(storeWith(endKeywordSettings(false)))
      companionConversation.start()
      routeCompanionUtterance('Почини тест', 0.4, actions)

      reportCompanionUserSpeakingForEndKeyword(true)
      vi.advanceTimersByTime(10_000)
      expect(utterances).toEqual([])

      reportCompanionUserSpeakingForEndKeyword(false)
      vi.advanceTimersByTime(2500)
      expect(utterances).toEqual(['Почини тест'])
    })

    it('"стоп" still ends the conversation at once and drops what was held', () => {
      dispose = initCompanionWakeListening(storeWith(endKeywordSettings(false)))
      companionConversation.start()
      routeCompanionUtterance('Почини тест', 0.4, actions)

      expect(routeCompanionUtterance('Стоп.', 0.4, actions)).toEqual({ stopped: true })
      expect(companionConversation.getState()).toBe('idle')
      expect(isCompanionRequestHeld()).toBe(false)
      vi.advanceTimersByTime(10_000)
      expect(utterances).toEqual([])
    })

    it('wake mode: continuation segments need no name, even past the follow-up window', () => {
      dispose = initCompanionWakeListening(storeWith(endKeywordSettings(true)))
      routeCompanionUtterance('Джарвис, хочу чтобы ты', 0.4, actions)
      reportCompanionUserSpeakingForEndKeyword(true)
      vi.advanceTimersByTime(20_000)
      reportCompanionUserSpeakingForEndKeyword(false)

      expect(routeCompanionUtterance('новости спорта', 0.05, actions)).toEqual({
        stopped: false,
        ignored: true
      })
      routeCompanionUtterance('проверил почту, давай', 0.4, actions)
      expect(utterances).toEqual(['хочу чтобы ты проверил почту'])
    })

    it('wake mode: the name still interrupts a reply immediately, without a keyword', () => {
      dispose = initCompanionWakeListening(storeWith(endKeywordSettings(true)))
      companionConversation.reportThinking()
      companionConversation.reportSpeaking()

      routeCompanionUtterance('Джарвис, подожди', 0.4, actions)
      expect(actions.bargeIn).toHaveBeenCalledTimes(1)
      expect(utterances).toEqual([])
      expect(isCompanionRequestHeld()).toBe(true)
    })
  })
})
