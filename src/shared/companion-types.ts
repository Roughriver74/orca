/** Voice companion ("Джарвис") settings, persisted under `GlobalSettings.companion`. */
export type CompanionSettings = {
  enabled: boolean
  /** Electron accelerator string (e.g. 'Alt+Space'), registered via globalShortcut. */
  hotkey: string
  /** Absolute path to the companion's home directory. Empty string = resolve to ~/assistant at runtime. */
  homeDir: string
  /** Speech model id from the speech model catalog, used for the always-listening dictation session. */
  sttModel: string
  /** Trailing silence (s) after which an in-progress utterance is finalized — unless the
   *  text looks cut off (see isCompanionUtteranceDangling), which holds it a bit longer. */
  endOfUtteranceSeconds: number
  /** Interrupt a spoken reply by talking over it (the hotkey barge-in always works). */
  voiceBargeIn: boolean
  /** Claude model the brain conversation runs on. */
  brainModel: CompanionBrainModel
  /** macOS only: `app.setLoginItemSettings({ openAtLogin })` so Orca (and the companion) is ready at login. */
  launchAtLogin: boolean
  tts: CompanionTtsSettings
  notify: CompanionNotifySettings
  wake: CompanionWakeSettings
}

/** Always-on listening that answers only when addressed by name. */
export type CompanionWakeSettings = {
  enabled: boolean
  /** Names/phrases that address Jarvis, matched case-, ё- and punctuation-insensitively. */
  phrases: string[]
  /** After a reply, follow-ups without the name are accepted this long; 0 = always say the name. */
  followUpMs: number
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

export type CompanionTtsProvider = 'silero' | 'yandex'

/** Male Yandex SpeechKit voices verified to work for the companion: filipp/ermil/zahar
 *  synthesize on both v1 and v3; alexander/kirill/anton/madirus require v3. */
export type CompanionYandexVoice =
  | 'filipp'
  | 'ermil'
  | 'zahar'
  | 'alexander'
  | 'kirill'
  | 'anton'
  | 'madirus'

/** The SpeechKit API generation a voice requires — v3-only voices cannot fall back to v1. */
export const YANDEX_VOICE_MIN_API: Record<CompanionYandexVoice, 'v1' | 'v3'> = {
  filipp: 'v1',
  ermil: 'v1',
  zahar: 'v1',
  alexander: 'v3',
  kirill: 'v3',
  anton: 'v3',
  madirus: 'v3'
}

export const YANDEX_VOICE_LABELS: Record<CompanionYandexVoice, string> = {
  filipp: 'Филипп',
  ermil: 'Ермил',
  zahar: 'Захар',
  alexander: 'Александр',
  kirill: 'Кирилл',
  anton: 'Антон',
  madirus: 'Мадирус'
}

export type CompanionTtsSettings = {
  ttsEnabled: boolean
  ttsVoice: CompanionTtsVoice
  /** Playback speed multiplier, 0.5–2.0. */
  ttsRate: number
  provider: CompanionTtsProvider
  yandexVoice: CompanionYandexVoice
  /** Spoken text is cut off at the last whole sentence within this many characters once
   *  the provider is Yandex (cost control) — the full reply still shows in the panel. */
  maxSpokenChars: number
  /** Once the trailing-30-day estimated Yandex spend reaches this many ₽, the service
   *  falls back to Silero automatically for the rest of the period. */
  yandexMonthlyBudgetRub: number
}

export type CompanionTtsUsagePeriod = {
  characters: number
  requestUnits: number
  requests: number
  costRub: number
  cacheHitsSaved: number
  cacheHitSavingsRub: number
}

/** Pushed to settings by `companion-tts-usage.ts`; prices are approximate (see
 *  companion-tts-yandex-pricing.ts) and the UI must say so. */
export type CompanionTtsUsageSnapshot = {
  today: CompanionTtsUsagePeriod
  last30Days: CompanionTtsUsagePeriod
  budgetRub: number
  budgetExceeded: boolean
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

/** One mic frame the panel reports while a reply plays, for voice barge-in detection. */
export type CompanionVoiceActivityFrame = {
  /** RMS of the echo-cancelled mic signal over the frame, 0..1. */
  micLevel: number
  /** RMS of the companion's own TTS output at the same moment, 0..1. */
  playbackLevel: number
  durationMs: number
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
