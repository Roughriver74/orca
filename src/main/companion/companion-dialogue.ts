// Wires the brain-agnostic `companionConversation` state machine to an actual Claude
// brain + Silero TTS: turns a finalized utterance into a streamed reply, synthesizes it
// sentence-by-sentence as it arrives, and tracks listening/thinking/speaking off the
// panel's own `companion:audio-state` reports (the single source of truth for whether
// audio is actually playing). `createCompanionDialogue` takes every side effect as a
// dependency so the turn-by-turn logic is testable without a real brain, TTS sidecar or
// window — `initCompanionDialogue` wires the real ones and keeps a module singleton so
// the hotkey / voice barge-in and the "New conversation" IPC handler can reach it.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type {
  CompanionAudioState,
  CompanionConversationState,
  CompanionSettings,
  CompanionTtsVoice,
  CompanionVoiceActivityFrame
} from '../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../shared/constants'
import {
  companionConversation,
  onCompanionStateChange,
  onCompanionUtterance
} from './companion-conversation'
import {
  getCompanionBrain,
  resolveCompanionHomeDir,
  type CompanionBrainEvent
} from './companion-brain'
import { onAudioState } from './companion-audio-output'
import { sendToCompanionWindow } from '../window/companion-window'
import type { CompanionTtsService } from './tts/companion-tts-service'
import { COMPANION_TTS_PRONUNCIATIONS_FILE_NAME } from './tts/companion-tts-pronunciation-dictionary'
import { takePendingDiscussionContext } from './companion-agent-watch'
import { createCompanionVoiceBargeInDetector } from './companion-voice-barge-in'
import {
  pickCompanionThinkingAckPhrase,
  scheduleCompanionThinkingAck
} from './companion-dialogue-thinking-ack'

// Why a fixed phrase rather than speaking `event.message`: brain errors are often raw
// English exception text (connection drops, provider errors) — unfit for a Russian voice
// reply. The full message still reaches the panel as text via `sendAssistantError`.
const COMPANION_ERROR_SPOKEN_PHRASE = 'Извините, не получилось ответить.'

export type CompanionDialogueConversation = {
  getState(): CompanionConversationState
  reportThinking(): void
  reportListening(): void
  reportSpeaking(): void
  reportAssistantFinal(text: string): void
}

export type CompanionDialogueBrain = {
  send(text: string, onEvent: (event: CompanionBrainEvent) => void): Promise<void>
  reset(): void
}

export type CompanionDialogueTtsStream = {
  pushDelta(text: string): void
  finish(): void
}

export type CompanionDialogueTtsOptions = {
  utteranceId: string
  voice: CompanionTtsVoice
  rate: number
  /** User pronunciation dictionary for Latin words; absent = built-in rules only. */
  pronunciationsPath?: string
}

export type CompanionDialogueTts = {
  speakStream(options: CompanionDialogueTtsOptions): CompanionDialogueTtsStream
  speak(text: string, options: CompanionDialogueTtsOptions): Promise<void>
  stop(utteranceId?: string): void
}

/** Resolved TTS handle for one turn, or `null` when voice replies are unavailable/disabled —
 *  the orchestrator then finishes the turn text-only and returns straight to listening. */
export type CompanionDialogueActiveTts = {
  service: CompanionDialogueTts
  voice: CompanionTtsVoice
  rate: number
  pronunciationsPath?: string
}

export type CompanionDiscussionContext = { text: string }

export type CompanionDialogueDeps = {
  conversation: CompanionDialogueConversation
  onUtterance: (listener: (text: string) => void) => () => void
  onStateChange: (listener: (state: CompanionConversationState) => void) => () => void
  onAudioState: (listener: (state: CompanionAudioState) => void) => () => void
  brain: CompanionDialogueBrain
  getTts: () => CompanionDialogueActiveTts | null
  sendAssistantDelta: (text: string) => void
  sendAssistantFinal: (text: string) => void
  sendAssistantError: (message: string) => void
  sendStateChanged: (state: CompanionConversationState) => void
  /** Read-once-and-clear context from an agent-status "Обсудить" action; `null` for an
   *  ordinary hotkey-opened conversation. */
  takeDiscussionContext: () => CompanionDiscussionContext | null
  /** Read per frame so toggling the setting takes effect mid-conversation. Gates whether
   *  `reportVoiceActivity` feeds the echo-margin detector at all (the `voiceBargeIn`
   *  setting) — see `isWakeModeActive` for what feeding it then does. */
  isVoiceBargeInEnabled: () => boolean
  /** In wake mode, loudness alone must never interrupt a reply (a TV could trigger it) —
   *  only an utterance naming Jarvis does, via companion-wake-listening.ts. So confirmed
   *  frames there only mark `hasConfirmedRealSpeech()`; outside wake mode they barge in
   *  immediately, as before. */
  isWakeModeActive: () => boolean
  /** One of a small fixed set so companion-tts-yandex-cache.ts caches it after first use. */
  pickThinkingAckPhrase: () => string
  randomUUID: () => string
}

export type CompanionDialogue = {
  /** Hotkey pressed (or user speech detected) mid-reply: stop audio immediately and return
   *  to listening without closing the conversation or touching the brain session. No-op
   *  outside 'speaking'. */
  bargeIn(): void
  /** One mic frame from the panel while a reply plays. Outside wake mode, barges in once
   *  user speech is confirmed over the companion's own echo and returns whether this frame
   *  did. In wake mode it never barges in by itself (see `isWakeModeActive`) — it only
   *  updates what `hasConfirmedRealSpeech()` reports, and always returns `false`. */
  reportVoiceActivity(frame: CompanionVoiceActivityFrame): boolean
  /** Whether this reply's playback has had mic speech confirmed as real (echo-margin +
   *  sustain), not Jarvis's own voice coming back through the mic. Consulted by
   *  companion-wake-listening.ts before honoring a wake-phrase interrupt while speaking —
   *  text matching the wake phrase alone is not proof it was the user, since with no
   *  headphones Jarvis can say his own name and hear himself. */
  hasConfirmedRealSpeech(): boolean
  /** Drops the brain session and any in-flight turn/audio; the next utterance starts fresh. */
  resetConversation(): void
  dispose(): void
}

export function createCompanionDialogue(deps: CompanionDialogueDeps): CompanionDialogue {
  // Bumped on every reset/new turn so a stale brain callback from a superseded turn
  // (reset mid-reply, barge-in) cannot resurrect state after the turn it belonged to.
  let turnGeneration = 0
  let activeUtteranceId: string | null = null
  let previousState: CompanionConversationState = deps.conversation.getState()
  let firstTurnPending = false
  let realSpeechConfirmed = false
  const voiceBargeIn = createCompanionVoiceBargeInDetector()

  function ttsOptions(
    tts: CompanionDialogueActiveTts,
    utteranceId: string
  ): CompanionDialogueTtsOptions {
    const options: CompanionDialogueTtsOptions = { utteranceId, voice: tts.voice, rate: tts.rate }
    if (tts.pronunciationsPath) {
      options.pronunciationsPath = tts.pronunciationsPath
    }
    return options
  }

  const offUtterance = deps.onUtterance((text) => {
    void handleUtterance(text)
  })

  const offState = deps.onStateChange((state) => {
    deps.sendStateChanged(state)
    if (state === 'listening' && previousState === 'idle') {
      firstTurnPending = true
    }
    if (state === 'idle') {
      turnGeneration += 1
      activeUtteranceId = null
      deps.getTts()?.service.stop()
    }
    previousState = state
  })

  const offAudio = deps.onAudioState((audio) => {
    if (audio.utteranceId !== activeUtteranceId) {
      return
    }
    if (audio.state === 'playing') {
      // Why this (not the delta stream starting) drives 'speaking': the panel's own
      // WebAudio playback — reported back here — is the only true signal that the user
      // is now hearing Jarvis and should stop being transcribed.
      voiceBargeIn.reset()
      realSpeechConfirmed = false
      deps.conversation.reportSpeaking()
      return
    }
    activeUtteranceId = null
    if (deps.conversation.getState() !== 'idle') {
      deps.conversation.reportListening()
    }
  })

  async function handleUtterance(text: string): Promise<void> {
    const generation = (turnGeneration += 1)
    deps.conversation.reportThinking()

    let prompt = text
    if (firstTurnPending) {
      firstTurnPending = false
      const context = deps.takeDiscussionContext()
      if (context) {
        prompt = `${context.text}\n\n${text}`
      }
    }

    const tts = deps.getTts()
    const utteranceId = deps.randomUUID()
    const streamHandle = tts ? tts.service.speakStream(ttsOptions(tts, utteranceId)) : null
    if (streamHandle) {
      activeUtteranceId = utteranceId
    }

    const ack = streamHandle
      ? scheduleCompanionThinkingAck({
          speak: (phrase) => streamHandle.pushDelta(phrase),
          pickPhrase: deps.pickThinkingAckPhrase,
          isCurrent: () => generation === turnGeneration
        })
      : null

    let hadError = false
    await deps.brain.send(prompt, (event: CompanionBrainEvent) => {
      if (generation !== turnGeneration) {
        return
      }
      if (event.type === 'delta') {
        ack?.onDelta()
        deps.sendAssistantDelta(event.text)
        streamHandle?.pushDelta(event.text)
      } else if (event.type === 'tool-start') {
        ack?.onToolStart()
      } else if (event.type === 'final') {
        ack?.dispose()
        deps.sendAssistantFinal(event.text)
        deps.conversation.reportAssistantFinal(event.text)
      } else {
        ack?.dispose()
        hadError = true
        deps.sendAssistantError(event.message)
      }
    })
    ack?.dispose()
    if (generation !== turnGeneration) {
      return
    }

    if (hadError) {
      tts?.service.stop(utteranceId)
      activeUtteranceId = null
      if (tts) {
        void tts.service.speak(COMPANION_ERROR_SPOKEN_PHRASE, ttsOptions(tts, deps.randomUUID()))
      }
      if (deps.conversation.getState() !== 'idle') {
        deps.conversation.reportListening()
      }
      return
    }

    if (streamHandle) {
      // 'speaking' -> 'listening' now follows from the audio-state subscription above.
      streamHandle.finish()
    } else if (deps.conversation.getState() !== 'idle') {
      deps.conversation.reportListening()
    }
  }

  function bargeIn(): void {
    if (deps.conversation.getState() !== 'speaking') {
      return
    }
    turnGeneration += 1
    deps.getTts()?.service.stop(activeUtteranceId ?? undefined)
    activeUtteranceId = null
    deps.conversation.reportListening()
  }

  function reportVoiceActivity(frame: CompanionVoiceActivityFrame): boolean {
    if (!deps.isVoiceBargeInEnabled() || deps.conversation.getState() !== 'speaking') {
      return false
    }
    if (!voiceBargeIn.feed(frame)) {
      return false
    }
    realSpeechConfirmed = true
    if (deps.isWakeModeActive()) {
      // Loudness alone must not interrupt in wake mode (a TV could trigger it) — only
      // marks confirmation; companion-wake-listening.ts's wake-phrase path barges in.
      return false
    }
    bargeIn()
    return true
  }

  function hasConfirmedRealSpeech(): boolean {
    return realSpeechConfirmed
  }

  function resetConversation(): void {
    turnGeneration += 1
    activeUtteranceId = null
    deps.getTts()?.service.stop()
    deps.brain.reset()
  }

  function dispose(): void {
    offUtterance()
    offState()
    offAudio()
  }

  return { bargeIn, reportVoiceActivity, hasConfirmedRealSpeech, resetConversation, dispose }
}

type CompanionDialogueSettingsStore = {
  getSettings(): { companion?: CompanionSettings }
}

/** Mutable module singleton holder (a `const` object, not a reassigned export binding, so
 *  TS treats `.current` as a normal writable property): the hotkey (barge-in) and the
 *  "New conversation" IPC handler read the live instance through this handle. */
export const companionDialogueHandle: { current: CompanionDialogue | null } = { current: null }

/** Wires the real brain/TTS/window singletons together and keeps the module-level
 *  instance the hotkey (barge-in) and the "New conversation" IPC handler read from.
 *  Returns a disposer; safe to call once per app lifetime (mirrors `initCompanionHotkey`).
 *
 *  `getTtsService` is injected by the Electron-only caller (`register-core-handlers.ts`):
 *  the real implementation imports the bundled `.py?asset&asarUnpack` Silero sidecar path,
 *  which only resolves inside a real (or asset-mocked) Vite/electron-vite build. A dynamic
 *  `import()` here would still make orcad's plain esbuild bundle — which must never need a
 *  `.py` loader — try to resolve that asset, since this module is itself reachable from
 *  orcad's graph via `companion-shortcut.ts`'s barge-in handle. */
export function initCompanionDialogue(
  store: CompanionDialogueSettingsStore,
  getTtsService?: (userDataDir: string) => CompanionTtsService | null
): () => void {
  const brain = getCompanionBrain(store)

  const dialogue = createCompanionDialogue({
    conversation: companionConversation,
    onUtterance: onCompanionUtterance,
    onStateChange: onCompanionStateChange,
    onAudioState,
    brain,
    getTts: () => {
      const companion = store.getSettings().companion
      const tts = companion?.tts ?? getDefaultCompanionSettings().tts
      if (!tts.ttsEnabled || !getTtsService) {
        return null
      }
      const userDataDir = getAppEnvironment().getPath('userData')
      const service = getTtsService(userDataDir)
      if (!service) {
        return null
      }
      return {
        service,
        voice: tts.ttsVoice,
        rate: tts.ttsRate,
        pronunciationsPath: join(
          resolveCompanionHomeDir(companion?.homeDir),
          COMPANION_TTS_PRONUNCIATIONS_FILE_NAME
        )
      }
    },
    sendAssistantDelta: (text) => sendToCompanionWindow('companion:assistantDelta', text),
    sendAssistantFinal: (text) => sendToCompanionWindow('companion:assistantFinal', text),
    sendAssistantError: (message) => sendToCompanionWindow('companion:assistantError', message),
    sendStateChanged: (state) => sendToCompanionWindow('companion:stateChanged', state),
    takeDiscussionContext: () => {
      const context = takePendingDiscussionContext()
      return context ? { text: context.notice.text } : null
    },
    // Feeds the echo-margin detector whenever voice barge-in is on, wake mode included —
    // what a confirmed frame then does differs by mode (see isWakeModeActive/reportVoiceActivity).
    isVoiceBargeInEnabled: () => store.getSettings().companion?.voiceBargeIn === true,
    isWakeModeActive: () => store.getSettings().companion?.wake.enabled === true,
    pickThinkingAckPhrase: pickCompanionThinkingAckPhrase,
    randomUUID
  })

  companionDialogueHandle.current = dialogue
  return () => {
    dialogue.dispose()
    companionDialogueHandle.current = null
  }
}
