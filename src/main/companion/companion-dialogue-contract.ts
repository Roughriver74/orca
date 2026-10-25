// The seams `createCompanionDialogue` is built on: every side effect it needs (brain, TTS,
// conversation state, panel) as a narrow dependency, plus the handle it returns.

import type {
  CompanionAudioState,
  CompanionConversationState,
  CompanionTtsVoice,
  CompanionVoiceActivityFrame,
  CompanionVoiceActivityResult,
  CompanionVoiceBargeInConfirmSettings
} from '../../shared/companion-types'
import type { CompanionBrainEvent } from './companion-brain'
import type { CompanionBargeInSpeechSource } from './companion-voice-barge-in-gate'

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
  /** Replies to turns Claude started itself (a background task finished); returns an unsubscribe. */
  onUnpromptedReply(listener: (text: string) => void): () => void
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
  /** Read-once lines about agents that finished while this conversation was open, prepended
   *  to every turn (not just the first) so the brain can retell them; `null` when none. */
  takeAgentBriefing: () => string | null
  /** Read per frame so toggling the setting takes effect mid-conversation. Gates whether
   *  `reportVoiceActivity` feeds the echo-margin detector at all (the `voiceBargeIn`
   *  setting) — see `isWakeModeActive` for what feeding it then does. */
  isVoiceBargeInEnabled: () => boolean
  /** In wake mode, loudness alone must never interrupt a reply (a TV could trigger it) —
   *  only an utterance naming Jarvis does, via companion-wake-listening.ts. So confirmed
   *  frames there only mark `hasConfirmedRealSpeech()`; outside wake mode they barge in. */
  isWakeModeActive: () => boolean
  /** Read per frame, like `isVoiceBargeInEnabled`; outside wake mode only. */
  getVoiceBargeInConfirm: () => CompanionVoiceBargeInConfirmSettings
  /** The VAD confirming that a barge-in is speech; fed the monitor's mic audio. */
  bargeInSpeech: CompanionBargeInSpeechSource
  /** One of a small fixed set so companion-tts-yandex-cache.ts caches it after first use. */
  pickThinkingAckPhrase: () => string
  randomUUID: () => string
}

export type CompanionDialogue = {
  /** Hotkey pressed, a stop command heard, or user speech confirmed mid-reply: stop audio
   *  immediately and return to listening without closing the conversation or touching the
   *  brain session. No-op outside 'speaking'. */
  bargeIn(): void
  /** One mic frame from the panel while a reply plays. Outside wake mode, barges in once
   *  user speech is confirmed over the companion's own echo (and, with confirmation on,
   *  by the VAD — `ducked` while that is pending). In wake mode it never barges in by
   *  itself (see `isWakeModeActive`) — it only updates `hasConfirmedRealSpeech()`. */
  reportVoiceActivity(frame: CompanionVoiceActivityFrame): CompanionVoiceActivityResult
  /** Whether this reply's playback has had mic speech confirmed as real (echo-margin +
   *  sustain), not Jarvis's own voice coming back through the mic. Consulted by
   *  companion-wake-listening.ts before honoring a wake-phrase interrupt while speaking —
   *  text matching the wake phrase alone is not proof it was the user, since with no
   *  headphones Jarvis can say his own name and hear himself. */
  hasConfirmedRealSpeech(): boolean
  /** Drops the brain session and any in-flight turn/audio; the next utterance starts fresh. */
  resetConversation(): void
  /** Unprompted short line (an agent notice), accepted only while the conversation is idle. Never
   *  preempts: waits behind whatever is playing, then plays in order. Cut off the moment a
   *  conversation opens so it never talks over the user. */
  speakAnnouncement(text: string): void
  dispose(): void
}
