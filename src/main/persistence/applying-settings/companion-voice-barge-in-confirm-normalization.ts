import {
  COMPANION_VOICE_BARGE_IN_CONFIRM_LIMITS,
  type CompanionVoiceBargeInConfirmSettings
} from '../../../shared/companion-types'

function clampMs(value: unknown, limits: { min: number; max: number }, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(limits.max, Math.max(limits.min, Math.round(value)))
    : fallback
}

export function normalizeCompanionVoiceBargeInConfirmSettings(
  value: unknown,
  defaults: CompanionVoiceBargeInConfirmSettings
): CompanionVoiceBargeInConfirmSettings {
  const source = typeof value === 'object' && value !== null ? value : undefined
  const enabledRaw = source && 'enabled' in source ? source.enabled : undefined
  return {
    enabled: typeof enabledRaw === 'boolean' ? enabledRaw : defaults.enabled,
    windowMs: clampMs(
      source && 'windowMs' in source ? source.windowMs : undefined,
      COMPANION_VOICE_BARGE_IN_CONFIRM_LIMITS.windowMs,
      defaults.windowMs
    ),
    minVoicedMs: clampMs(
      source && 'minVoicedMs' in source ? source.minVoicedMs : undefined,
      COMPANION_VOICE_BARGE_IN_CONFIRM_LIMITS.minVoicedMs,
      defaults.minVoicedMs
    )
  }
}
