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
  CompanionConversationState,
  CompanionSettings,
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
import { takeCompanionAgentBriefing, takePendingDiscussionContext } from './companion-agent-watch'
import { createCompanionVoiceBargeInDetector } from './companion-voice-barge-in'
import type {
  CompanionDialogue,
  CompanionDialogueActiveTts,
  CompanionDialogueDeps,
  CompanionDialogueTtsOptions
} from './companion-dialogue-contract'
import {
  pickCompanionThinkingAckPhrase,
  scheduleCompanionThinkingAck
} from './companion-dialogue-thinking-ack'

// Why a fixed phrase rather than speaking `event.message`: brain errors are often raw
// English exception text (connection drops, provider errors) — unfit for a Russian voice
// reply. The full message still reaches the panel as text via `sendAssistantError`.
const COMPANION_ERROR_SPOKEN_PHRASE = 'Извините, не получилось ответить.'

export function createCompanionDialogue(deps: CompanionDialogueDeps): CompanionDialogue {
  // Bumped on every reset/new turn so a stale brain callback from a superseded turn
  // (reset mid-reply, barge-in) cannot resurrect state after the turn it belonged to.
  let turnGeneration = 0
  let activeUtteranceId: string | null = null
  let announcementUtteranceId: string | null = null
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
      announcementUtteranceId = null
      deps.getTts()?.service.stop()
    } else if (announcementUtteranceId) {
      deps.getTts()?.service.stop(announcementUtteranceId)
      announcementUtteranceId = null
    }
    previousState = state
  })

  const offAudio = deps.onAudioState((audio) => {
    if (audio.utteranceId === announcementUtteranceId) {
      if (audio.state !== 'playing') {
        announcementUtteranceId = null
      }
      return
    }
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

    const preambles: string[] = []
    if (firstTurnPending) {
      firstTurnPending = false
      const context = deps.takeDiscussionContext()
      if (context) {
        preambles.push(context.text)
      }
    }
    const briefing = deps.takeAgentBriefing()
    if (briefing) {
      preambles.push(briefing)
    }
    const prompt = [...preambles, text].join('\n\n')

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

  function speakAnnouncement(text: string): void {
    if (deps.conversation.getState() !== 'idle' || activeUtteranceId !== null) {
      return
    }
    const tts = deps.getTts()
    if (!tts) {
      return
    }
    if (announcementUtteranceId) {
      tts.service.stop(announcementUtteranceId)
    }
    const utteranceId = deps.randomUUID()
    announcementUtteranceId = utteranceId
    tts.service.speak(text, ttsOptions(tts, utteranceId)).catch((error: unknown) => {
      console.error('[companion] notice announcement failed', error)
    })
  }

  function dispose(): void {
    offUtterance()
    offState()
    offAudio()
  }

  return {
    bargeIn,
    reportVoiceActivity,
    hasConfirmedRealSpeech,
    resetConversation,
    speakAnnouncement,
    dispose
  }
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
    takeAgentBriefing: takeCompanionAgentBriefing,
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
