// Wires the wake gate into the live conversation: keeps the panel's mic listening in the
// background while wake mode is on (no hotkey needed), routes every finalized utterance
// through the gate, and turns "стоп" into "stop answering" instead of "stop listening".
// Bare `companionConversation.reportUtterance` is still what runs with wake mode off.

import { powerSaveBlocker } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  isCompanionStopPhrase,
  type CompanionSettings,
  type CompanionWakeSettings
} from '../../shared/companion-types'
import { normalizeCompanionSettings } from '../persistence/applying-settings/companion-settings-normalization'
import {
  hideCompanionPanel,
  isCompanionPanelOpen,
  sendToCompanionWindow,
  showCompanionPanelForNotice
} from '../window/companion-window'
import { companionConversation, onCompanionStateChange } from './companion-conversation'
import { createCompanionWakeGate } from './companion-wake-gate'

export type CompanionWakeListeningStore = {
  getSettings: () => { companion?: CompanionSettings }
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => () => void
}

export type CompanionUtteranceResult = {
  /** The conversation ended (non-wake stop phrase): the panel stops listening. */
  stopped: boolean
  /** Not meant for Jarvis: the panel drops it from the transcript. */
  ignored?: boolean
}

let activeStore: CompanionWakeListeningStore | null = null

function readWakeSettings(): CompanionWakeSettings {
  const companion = normalizeCompanionSettings(activeStore?.getSettings().companion)
  return { ...companion.wake, enabled: companion.enabled && companion.wake.enabled }
}

const wakeGate = createCompanionWakeGate({ getSettings: readWakeSettings, now: () => Date.now() })

export function isCompanionWakeListeningEnabled(): boolean {
  return readWakeSettings().enabled
}

/** Hotkey or notice opened the panel: treat it as being addressed. */
export function addressCompanion(): void {
  wakeGate.address()
}

/** Panel hidden or conversation dismissed: wait for the wake phrase again. */
export function dismissCompanionAddress(): void {
  wakeGate.dismiss()
}

/**
 * One finalized utterance from the panel. `bargeIn` stops a reply in progress — in wake
 * mode only an utterance that names Jarvis can reach it while he is speaking.
 */
export function routeCompanionUtterance(
  text: string,
  level: number | undefined,
  actions: { bargeIn: () => void }
): CompanionUtteranceResult {
  const state = companionConversation.getState()
  const decision = wakeGate.decide(text, { state, level })
  if (decision.kind === 'ignore') {
    return { stopped: false, ignored: true }
  }
  if (!isCompanionWakeListeningEnabled()) {
    const result = companionConversation.reportUtterance(text)
    if (result.stopped) {
      hideCompanionPanel()
    }
    return result
  }
  if (state === 'speaking') {
    actions.bargeIn()
  }
  if (decision.kind === 'wake-only') {
    showCompanionPanelForNotice()
    return { stopped: false }
  }
  if (isCompanionStopPhrase(decision.text)) {
    // Why stop+start: idle cancels the in-flight turn and audio; listening resumes at once.
    companionConversation.stop()
    companionConversation.start()
    wakeGate.dismiss()
    hideCompanionPanel()
    return { stopped: false }
  }
  if (decision.addressed) {
    showCompanionPanelForNotice()
  }
  companionConversation.reportUtterance(decision.text)
  return { stopped: false }
}

/** Opens the panel for an agent notice's "Обсудить"; false while a conversation is busy.
 *  Wake mode's background conversation counts as free. */
export function openCompanionConversationForNotice(): boolean {
  const state = companionConversation.getState()
  const backgroundListening = state === 'listening' && isCompanionWakeListeningEnabled()
  if (state !== 'idle' && !backgroundListening) {
    return false
  }
  if (backgroundListening) {
    // Why stop+start: the dialogue attaches discussion context to the first turn after idle.
    companionConversation.stop()
  }
  companionConversation.start()
  showCompanionPanelForNotice()
  if (!backgroundListening) {
    sendToCompanionWindow('companion:conversationOpened')
  }
  wakeGate.address()
  return true
}

let powerSaveBlockerId: number | null = null

// Why: macOS App Nap throttles a backgrounded, never-shown process's whole render
// pipeline — including the WebAudio graph feeding the hidden panel's STT capture — once
// it has no visible windows and is not frontmost, independent of the window-level
// mitigations in configure-process.ts (those address Chromium's own renderer-priority
// and timer-throttling paths; this is the OS-level one). Mirrors agent-awake-service.ts's
// use of the same API for a similar "must keep working while backgrounded" requirement.
function startPreventingAppSuspension(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    return
  }
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
}

function stopPreventingAppSuspension(): void {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId)
  }
  powerSaveBlockerId = null
}

function startBackgroundListening(): void {
  if (companionConversation.getState() !== 'idle') {
    return
  }
  startPreventingAppSuspension()
  companionConversation.start()
  // Why no show: the panel window is alive (hidden) whenever the companion is enabled,
  // and a renderer that loads later picks the open conversation up on mount.
  sendToCompanionWindow('companion:conversationOpened')
}

/**
 * Starts/stops background listening as wake mode is toggled. Returns a disposer; call
 * once per app lifetime after the companion window wiring (mirrors `initCompanionHotkey`).
 */
export function initCompanionWakeListening(store: CompanionWakeListeningStore): () => void {
  activeStore = store
  let wasEnabled = isCompanionWakeListeningEnabled()
  if (wasEnabled) {
    startBackgroundListening()
  }
  const offSettings = store.onSettingsChanged((updates) => {
    if (!('companion' in updates)) {
      return
    }
    const enabled = isCompanionWakeListeningEnabled()
    if (enabled && !wasEnabled) {
      startBackgroundListening()
    } else if (!enabled && wasEnabled) {
      stopPreventingAppSuspension()
      if (!isCompanionPanelOpen()) {
        companionConversation.stop()
        sendToCompanionWindow('companion:conversationClosed')
      }
    }
    wasEnabled = enabled
  })
  const offState = onCompanionStateChange((state) => wakeGate.onStateChange(state))
  return () => {
    offSettings()
    offState()
    stopPreventingAppSuspension()
    activeStore = null
  }
}
