import { app, globalShortcut } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { companionConversation } from './companion-conversation'
import { companionDialogueHandle } from './companion-dialogue'
import { decideHotkeyPressAction } from './companion-hotkey-finalize'
import { getSpeechSttServiceIfInitialized } from '../speech/speech-runtime-service'
import {
  addressCompanion,
  dismissCompanionAddress,
  isCompanionRequestHeld,
  isCompanionWakeListeningEnabled,
  sendHeldCompanionRequest,
  sendNextCompanionSegmentAsIs
} from './companion-wake-listening'
import {
  destroyCompanionWindow,
  ensureCompanionWindowAlive,
  hideCompanionPanel,
  isCompanionPanelOpen,
  sendToCompanionWindow,
  showCompanionPanel
} from '../window/companion-window'
import { destroyCompanionIndicatorWindow } from '../window/companion-indicator-window'
import type { CompanionHotkeyStatus, CompanionSettings } from '../../shared/companion-types'

export type { CompanionHotkeyStatus } from '../../shared/companion-types'

/** Minimal `Store` slice this module depends on: readable per-test without a full `GlobalSettings` fixture. */
export type CompanionHotkeySettingsStore = {
  getSettings: () => { companion?: CompanionSettings }
}

export type CompanionHotkeyStore = CompanionHotkeySettingsStore & {
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => () => void
}

let currentHotkey: string | null = null
let lastError: string | null = null
// The panel reports every mic-meter isSpeaking transition over
// companion:reportSpeakingState — main has no other way to know whether the user is
// currently mid-utterance when the hotkey fires.
let userSpeaking = false

export function reportCompanionUserSpeaking(speaking: boolean): void {
  userSpeaking = speaking
}

export function getCompanionHotkeyStatus(): CompanionHotkeyStatus {
  return { registered: currentHotkey !== null, hotkey: currentHotkey, error: lastError }
}
/** Opens a fresh conversation, closes the current one, or (mid-reply/mid-utterance) does
 *  what `decideHotkeyPressAction` says — the hotkey's single action, shaped by
 *  `companionConversation`'s current state and whether the user is mid-utterance. In wake
 *  mode the mic is already listening in the background, so the hotkey only shows/hides
 *  the panel and counts as addressing Jarvis. */
export function toggleCompanionConversation(): void {
  const state = companionConversation.getState()
  if (state === 'idle') {
    companionConversation.start()
    showCompanionPanel()
    sendToCompanionWindow('companion:conversationOpened')
    addressCompanion()
    return
  }
  const action = decideHotkeyPressAction({
    userSpeaking,
    jarvisSpeaking: state === 'speaking',
    requestHeld: isCompanionRequestHeld()
  })
  if (action === 'barge-in') {
    companionDialogueHandle.current?.bargeIn()
    return
  }
  if (action === 'finalize') {
    // Forces the active VAD segment to end now — the panel's `speech:segmentEnd`
    // listener takes it from there (flushes STT, submits, same path as a natural
    // trailing-silence end-of-utterance). No-op if VAD segmentation is not active for
    // this session (model not downloaded, or voice focus off) — nothing to finalize early.
    sendNextCompanionSegmentAsIs()
    getSpeechSttServiceIfInitialized()?.finalizeNow()
    return
  }
  if (action === 'send-held') {
    sendHeldCompanionRequest()
    return
  }
  if (isCompanionWakeListeningEnabled()) {
    if (isCompanionPanelOpen()) {
      hideCompanionPanel()
      dismissCompanionAddress()
    } else {
      showCompanionPanel()
      addressCompanion()
    }
    return
  }
  companionConversation.stop()
  hideCompanionPanel()
  sendToCompanionWindow('companion:conversationClosed')
}

function unregisterCurrentHotkey(): void {
  if (currentHotkey) {
    globalShortcut.unregister(currentHotkey)
    currentHotkey = null
  }
}

/** (Re)registers the companion hotkey from current settings. Safe to call repeatedly. */
function applyCompanionHotkeySettings(store: CompanionHotkeySettingsStore): void {
  unregisterCurrentHotkey()
  lastError = null
  const companion = store.getSettings().companion
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({
      openAtLogin: companion?.enabled === true && companion.launchAtLogin === true
    })
  }
  if (!companion?.enabled) {
    destroyCompanionWindow()
    destroyCompanionIndicatorWindow()
    return
  }
  // Why: TTS playback must work even while the panel is hidden, so the window
  // (and its renderer's WebAudio pipeline) stays alive whenever companion is on.
  ensureCompanionWindowAlive()
  try {
    const registered = globalShortcut.register(companion.hotkey, toggleCompanionConversation)
    if (registered) {
      currentHotkey = companion.hotkey
    } else {
      lastError = `Hotkey "${companion.hotkey}" is already in use by another application.`
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
  }
}

/**
 * Registers the companion global hotkey from settings and keeps it in sync with
 * settings changes. Must run after `app.whenReady()`. Returns a disposer that
 * unregisters the hotkey (also called on `will-quit` via the caller).
 */
export function initCompanionHotkey(store: CompanionHotkeyStore): () => void {
  applyCompanionHotkeySettings(store)
  const unsubscribe = store.onSettingsChanged((updates) => {
    if ('companion' in updates) {
      applyCompanionHotkeySettings(store)
    }
  })
  return () => {
    unsubscribe()
    unregisterCurrentHotkey()
  }
}
