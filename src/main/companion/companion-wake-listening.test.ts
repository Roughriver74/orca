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
  initCompanionWakeListening,
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

function wakeSettings(enabled: boolean): CompanionSettings {
  const defaults = getDefaultCompanionSettings()
  return { ...defaults, enabled: true, wake: { ...defaults.wake, enabled } }
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
    expect(showForNotice).toHaveBeenCalled()
    expect(bargeIn).not.toHaveBeenCalled()
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
})
