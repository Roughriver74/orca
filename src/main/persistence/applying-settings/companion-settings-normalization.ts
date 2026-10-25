import type {
  CompanionQwenEmotion,
  CompanionBrainModel,
  CompanionNotifySettings,
  CompanionSettings,
  CompanionTtsProvider,
  CompanionTtsSettings,
  CompanionTtsVoice,
  CompanionVoiceFocusStrictness,
  CompanionYandexVoice
} from '../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../shared/constants'
import { normalizeCompanionVoiceBargeInConfirmSettings } from './companion-voice-barge-in-confirm-normalization'

const MIN_END_OF_UTTERANCE_SECONDS = 1
const MAX_END_OF_UTTERANCE_SECONDS = 5
const MIN_TTS_RATE = 0.7
const MAX_TTS_RATE = 1.6
const MAX_WAKE_FOLLOW_UP_MS = 30_000
const MAX_WAKE_PHRASES = 10
const MAX_WAKE_PHRASE_LENGTH = 40
const MIN_END_KEYWORD_FALLBACK_PAUSE_SECONDS = 1
const MAX_END_KEYWORD_FALLBACK_PAUSE_SECONDS = 30
const MIN_VOICE_FOCUS_END_OF_UTTERANCE_SECONDS = 0.3
const MAX_VOICE_FOCUS_END_OF_UTTERANCE_SECONDS = 5
const MIN_VOICE_FOCUS_MAX_UTTERANCE_SECONDS = 10
const MAX_VOICE_FOCUS_MAX_UTTERANCE_SECONDS = 180

const COMPANION_VOICE_FOCUS_STRICTNESS: Record<CompanionVoiceFocusStrictness, true> = {
  low: true,
  medium: true,
  high: true
}

function isCompanionVoiceFocusStrictness(value: unknown): value is CompanionVoiceFocusStrictness {
  return typeof value === 'string' && value in COMPANION_VOICE_FOCUS_STRICTNESS
}

const COMPANION_TTS_VOICES: Record<CompanionTtsVoice, true> = {
  eugene: true,
  xenia: true,
  baya: true,
  kseniya: true,
  aidar: true
}

const COMPANION_TTS_PROVIDERS: Record<CompanionTtsProvider, true> = {
  silero: true,
  yandex: true,
  qwen3: true
}

function isCompanionTtsProvider(value: unknown): value is CompanionTtsProvider {
  return typeof value === 'string' && value in COMPANION_TTS_PROVIDERS
}

const COMPANION_QWEN_EMOTIONS: Record<CompanionQwenEmotion, true> = {
  neutral: true,
  warm: true,
  mentor: true
}

function isCompanionQwenEmotion(value: unknown): value is CompanionQwenEmotion {
  return typeof value === 'string' && value in COMPANION_QWEN_EMOTIONS
}

const COMPANION_YANDEX_VOICES: Record<CompanionYandexVoice, true> = {
  filipp: true,
  ermil: true,
  zahar: true,
  alexander: true,
  kirill: true,
  anton: true,
  madirus: true
}

function isCompanionYandexVoice(value: unknown): value is CompanionYandexVoice {
  return typeof value === 'string' && value in COMPANION_YANDEX_VOICES
}

const MIN_MAX_SPOKEN_CHARS = 60
const MAX_MAX_SPOKEN_CHARS = 2000
const MIN_YANDEX_BUDGET_RUB = 0
const MAX_YANDEX_BUDGET_RUB = 100_000

function isCompanionTtsVoice(value: unknown): value is CompanionTtsVoice {
  return typeof value === 'string' && value in COMPANION_TTS_VOICES
}

const COMPANION_BRAIN_MODELS: Record<CompanionBrainModel, true> = {
  sonnet: true,
  opus: true,
  haiku: true
}

function isCompanionBrainModel(value: unknown): value is CompanionBrainModel {
  return typeof value === 'string' && value in COMPANION_BRAIN_MODELS
}

const COMPANION_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

function isCompanionTimeString(value: unknown): value is string {
  return typeof value === 'string' && COMPANION_TIME_PATTERN.test(value)
}

function normalizeCompanionNotifySettings(
  value: unknown,
  defaults: CompanionNotifySettings
): CompanionNotifySettings {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const quietFromRaw = source && 'quietFrom' in source ? source.quietFrom : undefined
  const quietToRaw = source && 'quietTo' in source ? source.quietTo : undefined
  const speakAloudRaw = source && 'speakAloud' in source ? source.speakAloud : undefined
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    quietFrom: isCompanionTimeString(quietFromRaw) ? quietFromRaw : defaults.quietFrom,
    quietTo: isCompanionTimeString(quietToRaw) ? quietToRaw : defaults.quietTo,
    speakAloud: typeof speakAloudRaw === 'boolean' ? speakAloudRaw : defaults.speakAloud
  }
}

function normalizeCompanionTtsSettings(
  value: unknown,
  defaults: CompanionTtsSettings
): CompanionTtsSettings {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const ttsRateRaw = source && 'ttsRate' in source ? source.ttsRate : undefined
  const ttsRate =
    typeof ttsRateRaw === 'number' && Number.isFinite(ttsRateRaw)
      ? Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, ttsRateRaw))
      : defaults.ttsRate
  const ttsEnabledRaw = source && 'ttsEnabled' in source ? source.ttsEnabled : undefined
  const ttsVoiceRaw = source && 'ttsVoice' in source ? source.ttsVoice : undefined
  const providerRaw = source && 'provider' in source ? source.provider : undefined
  const yandexVoiceRaw = source && 'yandexVoice' in source ? source.yandexVoice : undefined
  const qwenEmotionRaw = source && 'qwenEmotion' in source ? source.qwenEmotion : undefined
  const maxSpokenCharsRaw = source && 'maxSpokenChars' in source ? source.maxSpokenChars : undefined
  const maxSpokenChars =
    typeof maxSpokenCharsRaw === 'number' && Number.isFinite(maxSpokenCharsRaw)
      ? Math.min(
          MAX_MAX_SPOKEN_CHARS,
          Math.max(MIN_MAX_SPOKEN_CHARS, Math.round(maxSpokenCharsRaw))
        )
      : defaults.maxSpokenChars
  const yandexBudgetRaw =
    source && 'yandexMonthlyBudgetRub' in source ? source.yandexMonthlyBudgetRub : undefined
  const yandexMonthlyBudgetRub =
    typeof yandexBudgetRaw === 'number' && Number.isFinite(yandexBudgetRaw)
      ? Math.min(MAX_YANDEX_BUDGET_RUB, Math.max(MIN_YANDEX_BUDGET_RUB, yandexBudgetRaw))
      : defaults.yandexMonthlyBudgetRub
  return {
    ttsEnabled: typeof ttsEnabledRaw === 'boolean' ? ttsEnabledRaw : defaults.ttsEnabled,
    ttsVoice: isCompanionTtsVoice(ttsVoiceRaw) ? ttsVoiceRaw : defaults.ttsVoice,
    ttsRate,
    provider: isCompanionTtsProvider(providerRaw) ? providerRaw : defaults.provider,
    yandexVoice: isCompanionYandexVoice(yandexVoiceRaw) ? yandexVoiceRaw : defaults.yandexVoice,
    maxSpokenChars,
    yandexMonthlyBudgetRub,
    qwenEmotion: isCompanionQwenEmotion(qwenEmotionRaw) ? qwenEmotionRaw : defaults.qwenEmotion
  }
}

function normalizeCompanionPhraseList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((phrase): phrase is string => typeof phrase === 'string')
        .map((phrase) => phrase.trim().slice(0, MAX_WAKE_PHRASE_LENGTH))
        .filter((phrase) => /[\p{L}\p{N}]/u.test(phrase))
        .slice(0, MAX_WAKE_PHRASES)
    : []
}

function normalizeCompanionWakeSettings(
  value: unknown,
  defaults: CompanionSettings['wake']
): CompanionSettings['wake'] {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const phrasesRaw = source && 'phrases' in source ? source.phrases : undefined
  const followUpMsRaw = source && 'followUpMs' in source ? source.followUpMs : undefined
  const keywordSpotterRaw = source && 'keywordSpotter' in source ? source.keywordSpotter : undefined
  const phrases = normalizeCompanionPhraseList(phrasesRaw)
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    // Why fall back on empty: wake mode with no phrase would ignore every utterance.
    phrases: phrases.length > 0 ? phrases : defaults.phrases,
    followUpMs:
      typeof followUpMsRaw === 'number' && Number.isFinite(followUpMsRaw)
        ? Math.min(MAX_WAKE_FOLLOW_UP_MS, Math.max(0, followUpMsRaw))
        : defaults.followUpMs,
    keywordSpotter:
      typeof keywordSpotterRaw === 'boolean' ? keywordSpotterRaw : defaults.keywordSpotter
  }
}

function normalizeCompanionEndKeywordSettings(
  value: unknown,
  defaults: CompanionSettings['endKeyword']
): CompanionSettings['endKeyword'] {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const words = normalizeCompanionPhraseList(source && 'words' in source ? source.words : undefined)
  const pauseRaw =
    source && 'fallbackPauseSeconds' in source ? source.fallbackPauseSeconds : undefined
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    // Why fall back on empty: the mode would otherwise only ever send on the fallback pause.
    words: words.length > 0 ? words : defaults.words,
    fallbackPauseSeconds:
      typeof pauseRaw === 'number' && Number.isFinite(pauseRaw)
        ? Math.min(
            MAX_END_KEYWORD_FALLBACK_PAUSE_SECONDS,
            Math.max(MIN_END_KEYWORD_FALLBACK_PAUSE_SECONDS, pauseRaw)
          )
        : defaults.fallbackPauseSeconds
  }
}

function normalizeCompanionVoiceFocusSettings(
  value: unknown,
  defaults: CompanionSettings['voiceFocus']
): CompanionSettings['voiceFocus'] {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const endOfUtteranceSecondsRaw =
    source && 'endOfUtteranceSeconds' in source ? source.endOfUtteranceSeconds : undefined
  const maxUtteranceSecondsRaw =
    source && 'maxUtteranceSeconds' in source ? source.maxUtteranceSeconds : undefined
  const denoiserEnabledRaw =
    source && 'denoiserEnabled' in source ? source.denoiserEnabled : undefined
  const strictnessRaw = source && 'strictness' in source ? source.strictness : undefined
  const showDroppedRaw = source && 'showDropped' in source ? source.showDropped : undefined
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    endOfUtteranceSeconds:
      typeof endOfUtteranceSecondsRaw === 'number' && Number.isFinite(endOfUtteranceSecondsRaw)
        ? Math.min(
            MAX_VOICE_FOCUS_END_OF_UTTERANCE_SECONDS,
            Math.max(MIN_VOICE_FOCUS_END_OF_UTTERANCE_SECONDS, endOfUtteranceSecondsRaw)
          )
        : defaults.endOfUtteranceSeconds,
    maxUtteranceSeconds:
      typeof maxUtteranceSecondsRaw === 'number' && Number.isFinite(maxUtteranceSecondsRaw)
        ? Math.min(
            MAX_VOICE_FOCUS_MAX_UTTERANCE_SECONDS,
            Math.max(MIN_VOICE_FOCUS_MAX_UTTERANCE_SECONDS, maxUtteranceSecondsRaw)
          )
        : defaults.maxUtteranceSeconds,
    denoiserEnabled:
      typeof denoiserEnabledRaw === 'boolean' ? denoiserEnabledRaw : defaults.denoiserEnabled,
    strictness: isCompanionVoiceFocusStrictness(strictnessRaw)
      ? strictnessRaw
      : defaults.strictness,
    showDropped: typeof showDroppedRaw === 'boolean' ? showDroppedRaw : defaults.showDropped
  }
}

/**
 * Field-by-field like `normalizeNotificationSettings`: a blanket spread would let a
 * type-flipped persisted value (e.g. `enabled: "false"`, `endOfUtteranceMs: "fast"`)
 * through to the global hotkey registration and STT worker.
 */
export function normalizeCompanionSettings(value: unknown): CompanionSettings {
  const defaults = getDefaultCompanionSettings()
  const source = typeof value === 'object' && value !== null ? value : undefined

  const endOfUtteranceSecondsRaw =
    source && 'endOfUtteranceSeconds' in source ? source.endOfUtteranceSeconds : undefined
  // Migrates settings persisted before the ms->seconds rename (see CompanionSettings):
  // an old endOfUtteranceMs value still applies once, converted, until the user resaves.
  const legacyEndOfUtteranceMsRaw =
    source && 'endOfUtteranceMs' in source ? source.endOfUtteranceMs : undefined
  const endOfUtteranceSeconds =
    typeof endOfUtteranceSecondsRaw === 'number' && Number.isFinite(endOfUtteranceSecondsRaw)
      ? Math.min(
          MAX_END_OF_UTTERANCE_SECONDS,
          Math.max(MIN_END_OF_UTTERANCE_SECONDS, endOfUtteranceSecondsRaw)
        )
      : typeof legacyEndOfUtteranceMsRaw === 'number' && Number.isFinite(legacyEndOfUtteranceMsRaw)
        ? Math.min(
            MAX_END_OF_UTTERANCE_SECONDS,
            Math.max(MIN_END_OF_UTTERANCE_SECONDS, legacyEndOfUtteranceMsRaw / 1000)
          )
        : defaults.endOfUtteranceSeconds

  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const hotkeyRaw = source && 'hotkey' in source ? source.hotkey : undefined
  const homeDirRaw = source && 'homeDir' in source ? source.homeDir : undefined
  const sttModelRaw = source && 'sttModel' in source ? source.sttModel : undefined
  const brainModelRaw = source && 'brainModel' in source ? source.brainModel : undefined
  const launchAtLoginRaw = source && 'launchAtLogin' in source ? source.launchAtLogin : undefined
  const ttsRaw = source && 'tts' in source ? source.tts : undefined
  const notifyRaw = source && 'notify' in source ? source.notify : undefined
  const wakeRaw = source && 'wake' in source ? source.wake : undefined
  const endKeywordRaw = source && 'endKeyword' in source ? source.endKeyword : undefined
  const voiceFocusRaw = source && 'voiceFocus' in source ? source.voiceFocus : undefined
  const voiceBargeInRaw = source && 'voiceBargeIn' in source ? source.voiceBargeIn : undefined
  const showPanelOnAddressRaw =
    source && 'showPanelOnAddress' in source ? source.showPanelOnAddress : undefined
  const autoHidePanelAfterReplyRaw =
    source && 'autoHidePanelAfterReply' in source ? source.autoHidePanelAfterReply : undefined

  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    hotkey: typeof hotkeyRaw === 'string' && hotkeyRaw.trim() !== '' ? hotkeyRaw : defaults.hotkey,
    homeDir: typeof homeDirRaw === 'string' ? homeDirRaw : defaults.homeDir,
    sttModel:
      typeof sttModelRaw === 'string' && sttModelRaw.trim() !== ''
        ? sttModelRaw
        : defaults.sttModel,
    endOfUtteranceSeconds,
    voiceBargeIn: typeof voiceBargeInRaw === 'boolean' ? voiceBargeInRaw : defaults.voiceBargeIn,
    voiceBargeInConfirm: normalizeCompanionVoiceBargeInConfirmSettings(
      source && 'voiceBargeInConfirm' in source ? source.voiceBargeInConfirm : undefined,
      defaults.voiceBargeInConfirm
    ),
    brainModel: isCompanionBrainModel(brainModelRaw) ? brainModelRaw : defaults.brainModel,
    launchAtLogin:
      typeof launchAtLoginRaw === 'boolean' ? launchAtLoginRaw : defaults.launchAtLogin,
    tts: normalizeCompanionTtsSettings(ttsRaw, defaults.tts),
    notify: normalizeCompanionNotifySettings(notifyRaw, defaults.notify),
    wake: normalizeCompanionWakeSettings(wakeRaw, defaults.wake),
    endKeyword: normalizeCompanionEndKeywordSettings(endKeywordRaw, defaults.endKeyword),
    voiceFocus: normalizeCompanionVoiceFocusSettings(voiceFocusRaw, defaults.voiceFocus),
    showPanelOnAddress:
      typeof showPanelOnAddressRaw === 'boolean'
        ? showPanelOnAddressRaw
        : defaults.showPanelOnAddress,
    autoHidePanelAfterReply:
      typeof autoHidePanelAfterReplyRaw === 'boolean'
        ? autoHidePanelAfterReplyRaw
        : defaults.autoHidePanelAfterReply
  }
}
