// Wires the wake gate into the live conversation: keeps the panel's mic listening in the
// background while wake mode is on (no hotkey needed), routes every finalized utterance
// through the gate, and turns "стоп" into "stop answering" instead of "stop listening".
// Bare `companionConversation.reportUtterance` is still what runs with wake mode off.
// Either way, gated text goes through the end-keyword buffer (off by default) last, so
// barge-in and "стоп" never wait for a keyword.

import { app, powerSaveBlocker } from 'electron'
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
import { createCompanionEndKeywordBuffer } from './companion-end-keyword'
import { loadVoiceEnrollmentProfile, meanEmbedding } from './companion-voice-enrollment'
import {
  cosineSimilarity,
  decideVoiceFocus,
  strictnessToThreshold,
  type VoiceFocusMode
} from './companion-voice-focus'

export type CompanionWakeListeningStore = {
  getSettings: () => { companion?: CompanionSettings }
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => () => void
}

export type CompanionUtteranceResult = {
  /** The conversation ended (non-wake stop phrase): the panel stops listening. */
  stopped: boolean
  /** Not meant for Jarvis: the panel drops it from the transcript. */
  ignored?: boolean
  /** `ignored` was decided by voice focus (not the owner's voice), not the wake gate —
   *  lets the panel render a dim "отброшено" debug line when that setting is on. */
  droppedVoice?: boolean
}

let activeStore: CompanionWakeListeningStore | null = null

function readWakeSettings(): CompanionWakeSettings {
  const companion = normalizeCompanionSettings(activeStore?.getSettings().companion)
  return { ...companion.wake, enabled: companion.enabled && companion.wake.enabled }
}

/** Full normalized settings — used for the fields outside `wake` that still only matter in
 *  wake mode (`showPanelOnAddress`). */
function readCompanionSettings(): CompanionSettings {
  return normalizeCompanionSettings(activeStore?.getSettings().companion)
}

const wakeGate = createCompanionWakeGate({ getSettings: readWakeSettings, now: () => Date.now() })

const endKeywordBuffer = createCompanionEndKeywordBuffer({
  getSettings: () => readCompanionSettings().endKeyword,
  onFallback: (text) => {
    companionConversation.reportUtterance(text)
  }
})

function reportGatedUtterance(text: string): { stopped: boolean } {
  if (isCompanionStopPhrase(text)) {
    endKeywordBuffer.clear()
    return companionConversation.reportUtterance(text)
  }
  const request = endKeywordBuffer.push(text)
  return request === null ? { stopped: false } : companionConversation.reportUtterance(request)
}

/** End-keyword mode is holding a request that has not been sent yet. */
export function isCompanionRequestHeld(): boolean {
  return endKeywordBuffer.isPending()
}

/** Hotkey "send now" for a held end-keyword request. */
export function sendHeldCompanionRequest(): void {
  const text = endKeywordBuffer.take()
  if (text !== null) {
    companionConversation.reportUtterance(text)
  }
}

/** The hotkey is finalizing the current segment early: send it without the keyword. */
export function sendNextCompanionSegmentAsIs(): void {
  endKeywordBuffer.sendNextSegment()
}

export function reportCompanionUserSpeakingForEndKeyword(speaking: boolean): void {
  endKeywordBuffer.reportUserSpeaking(speaking)
}

/** "Новый разговор": a half-dictated request must not leak into the fresh session. */
export function clearHeldCompanionRequest(): void {
  endKeywordBuffer.clear()
}

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

// A segment dropped by voice focus this long ago no longer counts as "the owner was
// recently talking" for the hotkey-mode leniency in companion-voice-focus.ts's
// decideVoiceFocus — long enough to survive a normal thinking pause, short enough that a
// stranger who starts talking well after the owner went quiet is still dropped.
const OWNER_RECENTLY_ACTIVE_MS = 30_000
let lastOwnerVoiceAt: number | null = null

/**
 * Runs companion-voice-focus.ts's pure policy against the enrolled owner profile for one
 * finalized VAD segment. `embedding` is undefined/null whenever VAD segmentation was not
 * active for this utterance (model not downloaded, voice focus off, or the legacy energy
 * timer flushed it instead) — decideVoiceFocus already fails open in that case, so no
 * extra guard is needed here.
 */
function evaluateIncomingVoiceFocus(
  embedding: number[] | null | undefined,
  continuing: boolean
): {
  kind: 'pass' | 'drop'
} {
  const companion = normalizeCompanionSettings(activeStore?.getSettings().companion)
  if (!companion.voiceFocus.enabled) {
    return { kind: 'pass' }
  }
  const profile = loadVoiceEnrollmentProfile(app.getPath('userData'))
  const enrolled = profile !== null && profile.phraseEmbeddings.length > 0
  const similarity =
    enrolled && profile && embedding ? cosineSimilarity(embedding, meanEmbedding(profile)) : null
  const mode: VoiceFocusMode =
    !isCompanionWakeListeningEnabled() || wakeGate.isAddressed() || continuing ? 'hotkey' : 'wake'
  const ownerRecentlyActive =
    lastOwnerVoiceAt !== null && Date.now() - lastOwnerVoiceAt < OWNER_RECENTLY_ACTIVE_MS
  const decision = decideVoiceFocus({
    mode,
    verification: { enrolled, similarity },
    threshold: strictnessToThreshold(companion.voiceFocus.strictness),
    ownerRecentlyActive
  })
  if (decision.kind === 'pass') {
    lastOwnerVoiceAt = Date.now()
    return { kind: 'pass' }
  }
  return { kind: 'drop' }
}

/** Test-only: owner-recently-active tracking persists across calls at module scope. */
export function resetCompanionVoiceFocusTrackingForTesting(): void {
  lastOwnerVoiceAt = null
}

/**
 * One finalized utterance from the panel. `bargeIn` stops a reply in progress — in wake
 * mode only an utterance that names Jarvis can reach it while he is speaking, and only
 * once `isRealSpeechConfirmed()` says it is not Jarvis's own TTS echo (with no
 * headphones, the mic hears him too — see companion-dialogue.ts's
 * `hasConfirmedRealSpeech`). `embedding` is the segment's speaker embedding
 * (undefined/null when VAD segmentation was not active) — dropped before the wake gate
 * even sees the text, so a stranger saying the wake phrase never reaches it.
 */
export function routeCompanionUtterance(
  text: string,
  level: number | undefined,
  actions: { bargeIn: () => void; isRealSpeechConfirmed: () => boolean },
  embedding?: number[] | null
): CompanionUtteranceResult {
  const continuing = endKeywordBuffer.isPending()
  if (evaluateIncomingVoiceFocus(embedding, continuing).kind === 'drop') {
    return { stopped: false, ignored: true, droppedVoice: true }
  }
  const state = companionConversation.getState()
  const decision = wakeGate.decide(text, { state, level, continuing })
  if (decision.kind === 'ignore') {
    return { stopped: false, ignored: true }
  }
  if (!isCompanionWakeListeningEnabled()) {
    const result = reportGatedUtterance(text)
    if (result.stopped) {
      hideCompanionPanel()
    }
    return result
  }
  if (state === 'speaking') {
    if (!actions.isRealSpeechConfirmed()) {
      return { stopped: false, ignored: true }
    }
    actions.bargeIn()
  }
  if (decision.kind === 'wake-only') {
    // Backlog #28: a bare wake phrase only changes the pill indicator's state
    // (companion-indicator-lifecycle.ts reacts to `companionConversation`'s state on its
    // own) — the big panel never opens for it, regardless of `showPanelOnAddress`.
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
  if (decision.addressed && readCompanionSettings().showPanelOnAddress) {
    showCompanionPanelForNotice()
  }
  reportGatedUtterance(decision.text)
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
  const offState = onCompanionStateChange((state) => {
    wakeGate.onStateChange(state)
    if (state === 'idle') {
      endKeywordBuffer.clear()
    }
  })
  return () => {
    offSettings()
    offState()
    stopPreventingAppSuspension()
    activeStore = null
  }
}
