import type {
  CompanionBrainModel,
  CompanionNotifySettings,
  CompanionSettings,
  CompanionTtsSettings,
  CompanionTtsVoice
} from '../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../shared/constants'

const MIN_END_OF_UTTERANCE_MS = 300
const MAX_END_OF_UTTERANCE_MS = 10_000
const MIN_TTS_RATE = 0.5
const MAX_TTS_RATE = 2

const COMPANION_TTS_VOICES: Record<CompanionTtsVoice, true> = {
  eugene: true,
  xenia: true,
  baya: true,
  kseniya: true,
  aidar: true
}

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
  const speakRaw = source && 'speak' in source ? source.speak : undefined
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    quietFrom: isCompanionTimeString(quietFromRaw) ? quietFromRaw : defaults.quietFrom,
    quietTo: isCompanionTimeString(quietToRaw) ? quietToRaw : defaults.quietTo,
    speak: typeof speakRaw === 'boolean' ? speakRaw : defaults.speak
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
  return {
    ttsEnabled: typeof ttsEnabledRaw === 'boolean' ? ttsEnabledRaw : defaults.ttsEnabled,
    ttsVoice: isCompanionTtsVoice(ttsVoiceRaw) ? ttsVoiceRaw : defaults.ttsVoice,
    ttsRate
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

  const endOfUtteranceMsRaw =
    source && 'endOfUtteranceMs' in source ? source.endOfUtteranceMs : undefined
  const endOfUtteranceMs =
    typeof endOfUtteranceMsRaw === 'number' && Number.isFinite(endOfUtteranceMsRaw)
      ? Math.min(MAX_END_OF_UTTERANCE_MS, Math.max(MIN_END_OF_UTTERANCE_MS, endOfUtteranceMsRaw))
      : defaults.endOfUtteranceMs

  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  const hotkeyRaw = source && 'hotkey' in source ? source.hotkey : undefined
  const homeDirRaw = source && 'homeDir' in source ? source.homeDir : undefined
  const sttModelRaw = source && 'sttModel' in source ? source.sttModel : undefined
  const brainModelRaw = source && 'brainModel' in source ? source.brainModel : undefined
  const launchAtLoginRaw = source && 'launchAtLogin' in source ? source.launchAtLogin : undefined
  const ttsRaw = source && 'tts' in source ? source.tts : undefined
  const notifyRaw = source && 'notify' in source ? source.notify : undefined

  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    hotkey: typeof hotkeyRaw === 'string' && hotkeyRaw.trim() !== '' ? hotkeyRaw : defaults.hotkey,
    homeDir: typeof homeDirRaw === 'string' ? homeDirRaw : defaults.homeDir,
    sttModel:
      typeof sttModelRaw === 'string' && sttModelRaw.trim() !== ''
        ? sttModelRaw
        : defaults.sttModel,
    endOfUtteranceMs,
    brainModel: isCompanionBrainModel(brainModelRaw) ? brainModelRaw : defaults.brainModel,
    launchAtLogin:
      typeof launchAtLoginRaw === 'boolean' ? launchAtLoginRaw : defaults.launchAtLogin,
    tts: normalizeCompanionTtsSettings(ttsRaw, defaults.tts),
    notify: normalizeCompanionNotifySettings(notifyRaw, defaults.notify)
  }
}
