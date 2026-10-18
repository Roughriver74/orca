import { describe, expect, it } from 'vitest'
import { normalizeCompanionSettings } from './companion-settings-normalization'
import { getDefaultCompanionSettings } from '../../../shared/constants'

describe('normalizeCompanionSettings', () => {
  it('fills in defaults for a missing block', () => {
    expect(normalizeCompanionSettings(undefined)).toEqual(getDefaultCompanionSettings())
    expect(normalizeCompanionSettings(null)).toEqual(getDefaultCompanionSettings())
  })

  it('passes through a well-formed block unchanged', () => {
    const persisted = {
      enabled: true,
      hotkey: 'Control+Space',
      homeDir: '/Users/evgenijsikunov/assistant',
      sttModel: 'gigaam-v3-e2e-rnnt-ru',
      endOfUtteranceMs: 2000,
      voiceBargeIn: true,
      brainModel: 'opus',
      launchAtLogin: true,
      tts: {
        ttsEnabled: false,
        ttsVoice: 'baya',
        ttsRate: 1.25,
        provider: 'yandex',
        yandexVoice: 'alexander',
        maxSpokenChars: 180,
        yandexMonthlyBudgetRub: 150
      },
      notify: { enabled: false, quietFrom: '23:00', quietTo: '07:30', speak: true },
      wake: { enabled: true, phrases: ['джарвис', 'эй компьютер'], followUpMs: 5000 }
    }
    expect(normalizeCompanionSettings(persisted)).toEqual(persisted)
  })

  it('repairs type-flipped fields back to defaults', () => {
    const normalized = normalizeCompanionSettings({
      enabled: 'true',
      hotkey: 42,
      homeDir: 42,
      sttModel: null,
      endOfUtteranceMs: 'fast',
      brainModel: 'gpt-5',
      launchAtLogin: 'yes',
      tts: { ttsEnabled: 'yes', ttsVoice: 'robot', ttsRate: 'fast' },
      voiceBargeIn: 'on',
      notify: { enabled: 'yes', quietFrom: '25:99', quietTo: 42, speak: 'no' },
      wake: { enabled: 1, phrases: 'джарвис', followUpMs: 'long' }
    })
    expect(normalized).toEqual(getDefaultCompanionSettings())
  })

  it('rejects an empty-string hotkey and sttModel', () => {
    const normalized = normalizeCompanionSettings({ hotkey: '   ', sttModel: '' })
    expect(normalized.hotkey).toBe(getDefaultCompanionSettings().hotkey)
    expect(normalized.sttModel).toBe(getDefaultCompanionSettings().sttModel)
  })

  it('clamps endOfUtteranceMs into a sane range', () => {
    expect(normalizeCompanionSettings({ endOfUtteranceMs: 10 }).endOfUtteranceMs).toBe(300)
    expect(normalizeCompanionSettings({ endOfUtteranceMs: 999_999 }).endOfUtteranceMs).toBe(10_000)
    expect(normalizeCompanionSettings({ endOfUtteranceMs: Number.NaN }).endOfUtteranceMs).toBe(
      getDefaultCompanionSettings().endOfUtteranceMs
    )
  })

  it('ignores a non-object value entirely', () => {
    expect(normalizeCompanionSettings('nope')).toEqual(getDefaultCompanionSettings())
    expect(normalizeCompanionSettings(42)).toEqual(getDefaultCompanionSettings())
  })

  it('clamps ttsRate and rejects an unknown voice', () => {
    expect(normalizeCompanionSettings({ tts: { ttsRate: 0.1 } }).tts.ttsRate).toBe(0.5)
    expect(normalizeCompanionSettings({ tts: { ttsRate: 10 } }).tts.ttsRate).toBe(2)
    expect(normalizeCompanionSettings({ tts: { ttsVoice: 'robot' } }).tts.ttsVoice).toBe(
      getDefaultCompanionSettings().tts.ttsVoice
    )
    expect(normalizeCompanionSettings({ tts: { ttsVoice: 'aidar' } }).tts.ttsVoice).toBe('aidar')
  })

  it('defaults a missing tts block', () => {
    expect(normalizeCompanionSettings({ enabled: true }).tts).toEqual(
      getDefaultCompanionSettings().tts
    )
  })

  it('defaults a missing notify block', () => {
    expect(normalizeCompanionSettings({ enabled: true }).notify).toEqual(
      getDefaultCompanionSettings().notify
    )
  })

  it('rejects a malformed quiet-hours time string', () => {
    expect(normalizeCompanionSettings({ notify: { quietFrom: '9:00' } }).notify.quietFrom).toBe(
      getDefaultCompanionSettings().notify.quietFrom
    )
    expect(normalizeCompanionSettings({ notify: { quietTo: '24:00' } }).notify.quietTo).toBe(
      getDefaultCompanionSettings().notify.quietTo
    )
    expect(normalizeCompanionSettings({ notify: { quietFrom: '06:45' } }).notify.quietFrom).toBe(
      '06:45'
    )
  })

  it('passes through notify.enabled and notify.speak booleans', () => {
    const normalized = normalizeCompanionSettings({ notify: { enabled: false, speak: true } })
    expect(normalized.notify.enabled).toBe(false)
    expect(normalized.notify.speak).toBe(true)
  })

  it('accepts a known brainModel and rejects an unknown one', () => {
    expect(normalizeCompanionSettings({ brainModel: 'opus' }).brainModel).toBe('opus')
    expect(normalizeCompanionSettings({ brainModel: 'haiku' }).brainModel).toBe('haiku')
    expect(normalizeCompanionSettings({ brainModel: 'gpt-5' }).brainModel).toBe(
      getDefaultCompanionSettings().brainModel
    )
  })

  it('coerces launchAtLogin to a boolean, defaulting a type-flipped value', () => {
    expect(normalizeCompanionSettings({ launchAtLogin: true }).launchAtLogin).toBe(true)
    expect(normalizeCompanionSettings({ launchAtLogin: 'true' }).launchAtLogin).toBe(
      getDefaultCompanionSettings().launchAtLogin
    )
  })

  it('accepts a known provider and rejects an unknown one', () => {
    expect(normalizeCompanionSettings({ tts: { provider: 'yandex' } }).tts.provider).toBe('yandex')
    expect(normalizeCompanionSettings({ tts: { provider: 'eleven-labs' } }).tts.provider).toBe(
      getDefaultCompanionSettings().tts.provider
    )
  })

  it('accepts a known Yandex voice and rejects an unknown one', () => {
    expect(normalizeCompanionSettings({ tts: { yandexVoice: 'filipp' } }).tts.yandexVoice).toBe(
      'filipp'
    )
    expect(normalizeCompanionSettings({ tts: { yandexVoice: 'robot' } }).tts.yandexVoice).toBe(
      getDefaultCompanionSettings().tts.yandexVoice
    )
  })

  it('clamps maxSpokenChars into a sane range and rejects a non-number', () => {
    expect(normalizeCompanionSettings({ tts: { maxSpokenChars: 10 } }).tts.maxSpokenChars).toBe(60)
    expect(normalizeCompanionSettings({ tts: { maxSpokenChars: 9000 } }).tts.maxSpokenChars).toBe(
      2000
    )
    expect(normalizeCompanionSettings({ tts: { maxSpokenChars: '250' } }).tts.maxSpokenChars).toBe(
      getDefaultCompanionSettings().tts.maxSpokenChars
    )
  })

  it('clamps yandexMonthlyBudgetRub into a non-negative range and rejects a non-number', () => {
    expect(
      normalizeCompanionSettings({ tts: { yandexMonthlyBudgetRub: -50 } }).tts
        .yandexMonthlyBudgetRub
    ).toBe(0)
    expect(
      normalizeCompanionSettings({ tts: { yandexMonthlyBudgetRub: 1_000_000 } }).tts
        .yandexMonthlyBudgetRub
    ).toBe(100_000)
    expect(
      normalizeCompanionSettings({ tts: { yandexMonthlyBudgetRub: 'free' } }).tts
        .yandexMonthlyBudgetRub
    ).toBe(getDefaultCompanionSettings().tts.yandexMonthlyBudgetRub)
  })

  it('keeps only usable wake phrases and clamps the follow-up window', () => {
    const wake = normalizeCompanionSettings({
      wake: { enabled: true, phrases: ['  Пятница ', '', '!!!', 7], followUpMs: 120_000 }
    }).wake
    expect(wake).toEqual({ enabled: true, phrases: ['Пятница'], followUpMs: 30_000 })
    expect(normalizeCompanionSettings({ wake: { phrases: [] } }).wake.phrases).toEqual(['джарвис'])
    expect(normalizeCompanionSettings({ wake: { followUpMs: -5 } }).wake.followUpMs).toBe(0)
  })
})
