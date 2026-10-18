/** Voice companion ("Джарвис") settings, persisted under `GlobalSettings.companion`. */
export type CompanionSettings = {
  enabled: boolean
  /** Electron accelerator string (e.g. 'Alt+Space'), registered via globalShortcut. */
  hotkey: string
  /** Absolute path to the companion's home directory. Empty string = resolve to ~/assistant at runtime. */
  homeDir: string
  /** Speech model id from the speech model catalog, used for the always-listening dictation session. */
  sttModel: string
  /** Trailing silence (ms) after which an in-progress utterance is finalized. */
  endOfUtteranceMs: number
  /** Claude model the brain conversation runs on. */
  brainModel: CompanionBrainModel
  /** macOS only: `app.setLoginItemSettings({ openAtLogin })` so Orca (and the companion) is ready at login. */
  launchAtLogin: boolean
  tts: CompanionTtsSettings
  notify: CompanionNotifySettings
}

export type CompanionBrainModel = 'sonnet' | 'opus' | 'haiku'

export type CompanionNotifySettings = {
  enabled: boolean
  /** "HH:MM" (24h). Quiet window may wrap past midnight (e.g. 22:00\u201308:00). */
  quietFrom: string
  quietTo: string
  /** Speak the notice aloud via TTS once delivered. Flag only \u2014 wiring lands with the brain integration. */
  speak: boolean
}

export type CompanionTtsVoice = 'eugene' | 'xenia' | 'baya' | 'kseniya' | 'aidar'

export type CompanionTtsSettings = {
  ttsEnabled: boolean
  ttsVoice: CompanionTtsVoice
  /** Playback speed multiplier, 0.5–2.0. */
  ttsRate: number
}

/** Pushed by the TTS provisioner (model download/load) over `companion:ttsProvisioningStatus`. */
export type CompanionTtsProvisioningStatus = {
  status: 'idle' | 'downloading' | 'ready' | 'error'
  progress?: number
  error?: string
}

export type CompanionConversationState = 'idle' | 'listening' | 'thinking' | 'speaking'

export type CompanionHotkeyStatus = {
  registered: boolean
  hotkey: string | null
  error: string | null
}

/** Pushed over `companion:notice` when another agent's hook status (not the companion's own
 *  brain turn) transitions into done/blocked/waiting while notifications are due. */
export type CompanionAgentNotice = {
  id: string
  text: string
  createdAt: number
}

/** One streamed TTS audio chunk, sent gaplessly in `seq` order per `utteranceId`. */
export type CompanionAudioChunk = {
  utteranceId: string
  seq: number
  sampleRate: number
  /** Mono PCM samples in [-1, 1]. */
  pcm: Float32Array
  final: boolean
}

export type CompanionAudioPlaybackState = 'playing' | 'ended' | 'stopped'

export type CompanionAudioState = {
  utteranceId: string
  state: CompanionAudioPlaybackState
}

/** Utterances that end a companion conversation, matched exact/case/punctuation-insensitive. */
const COMPANION_STOP_PHRASES: Record<string, true> = {
  стоп: true,
  отбой: true
}

/** True when the whole utterance (not a substring) is a companion stop phrase. */
export function isCompanionStopPhrase(utterance: string): boolean {
  const normalized = utterance
    .trim()
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, '')
    .trim()
  return COMPANION_STOP_PHRASES[normalized] === true
}

/** Slice of `GlobalSettings`; optional for profiles saved before the companion existed. */
export type CompanionGlobalSettings = { companion?: CompanionSettings }
