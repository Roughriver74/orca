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
      endOfUtteranceSeconds: 2,
      voiceBargeIn: true,
      voiceBargeInConfirm: { enabled: false, windowMs: 800, minVoicedMs: 300 },
      showPanelOnAddress: true,
      autoHidePanelAfterReply: false,
      brainModel: 'opus',
      launchAtLogin: true,
      tts: {
        ttsEnabled: false,
        ttsVoice: 'baya',
        ttsRate: 1.25,
        provider: 'yandex',
        yandexVoice: 'alexander',
        maxSpokenChars: 180,
        yandexMonthlyBudgetRub: 150,
        qwenEmotion: 'mentor'
      },
      notify: { enabled: false, quietFrom: '23:00', quietTo: '07:30', speakAloud: false },
      wake: {
        enabled: true,
        phrases: ['джарвис', 'эй компьютер'],
        followUpMs: 5000,
        keywordSpotter: true
      },
      endKeyword: { enabled: true, words: ['думай', 'на этом всё'], fallbackPauseSeconds: 6 },
      voiceFocus: {
        enabled: true,
        endOfUtteranceSeconds: 1.5,
        maxUtteranceSeconds: 45,
        denoiserEnabled: true,
        strictness: 'high',
        showDropped: true
      }
    }
    expect(normalizeCompanionSettings(persisted)).toEqual(persisted)
  })

  it('repairs type-flipped fields back to defaults', () => {
    const normalized = normalizeCompanionSettings({
      enabled: 'true',
      hotkey: 42,
      homeDir: 42,
      sttModel: null,
      endOfUtteranceSeconds: 'fast',
      brainModel: 'gpt-5',
      launchAtLogin: 'yes',
      tts: { ttsEnabled: 'yes', ttsVoice: 'robot', ttsRate: 'fast' },
      voiceBargeIn: 'on',
      voiceBargeInConfirm: { enabled: 'yes', windowMs: 'short', minVoicedMs: null },
      notify: { enabled: 'yes', quietFrom: '25:99', quietTo: 42, speakAloud: 'no' },
      wake: { enabled: 1, phrases: 'джарвис', followUpMs: 'long', keywordSpotter: 'on' }
    })
    expect(normalized).toEqual(getDefaultCompanionSettings())
  })

  it('rejects an empty-string hotkey and sttModel', () => {
    const normalized = normalizeCompanionSettings({ hotkey: '   ', sttModel: '' })
    expect(normalized.hotkey).toBe(getDefaultCompanionSettings().hotkey)
    expect(normalized.sttModel).toBe(getDefaultCompanionSettings().sttModel)
  })

  it('clamps endOfUtteranceSeconds into a sane range', () => {
    expect(normalizeCompanionSettings({ endOfUtteranceSeconds: 0.1 }).endOfUtteranceSeconds).toBe(1)
    expect(normalizeCompanionSettings({ endOfUtteranceSeconds: 999 }).endOfUtteranceSeconds).toBe(5)
    expect(
      normalizeCompanionSettings({ endOfUtteranceSeconds: Number.NaN }).endOfUtteranceSeconds
    ).toBe(getDefaultCompanionSettings().endOfUtteranceSeconds)
  })

  it('clamps the barge-in confirmation window and minimum speech into their slider ranges', () => {
    const tooSmall = normalizeCompanionSettings({
      voiceBargeInConfirm: { enabled: true, windowMs: 10, minVoicedMs: 1 }
    }).voiceBargeInConfirm
    expect(tooSmall).toEqual({ enabled: true, windowMs: 300, minVoicedMs: 100 })
    const tooLarge = normalizeCompanionSettings({
      voiceBargeInConfirm: { enabled: true, windowMs: 99_999, minVoicedMs: 99_999 }
    }).voiceBargeInConfirm
    expect(tooLarge).toEqual({ enabled: true, windowMs: 1500, minVoicedMs: 600 })
  })

  it('migrates a legacy endOfUtteranceMs value to seconds, clamped', () => {
    expect(normalizeCompanionSettings({ endOfUtteranceMs: 2000 }).endOfUtteranceSeconds).toBe(2)
    expect(normalizeCompanionSettings({ endOfUtteranceMs: 100 }).endOfUtteranceSeconds).toBe(1)
    expect(normalizeCompanionSettings({ endOfUtteranceMs: 999_999 }).endOfUtteranceSeconds).toBe(5)
    // A new-format value present alongside the legacy one wins.
    expect(
      normalizeCompanionSettings({ endOfUtteranceMs: 4000, endOfUtteranceSeconds: 1.5 })
        .endOfUtteranceSeconds
    ).toBe(1.5)
  })

  it('ignores a non-object value entirely', () => {
    expect(normalizeCompanionSettings('nope')).toEqual(getDefaultCompanionSettings())
    expect(normalizeCompanionSettings(42)).toEqual(getDefaultCompanionSettings())
  })

  it('clamps ttsRate and rejects an unknown voice', () => {
    expect(normalizeCompanionSettings({ tts: { ttsRate: 0.1 } }).tts.ttsRate).toBe(0.7)
    expect(normalizeCompanionSettings({ tts: { ttsRate: 10 } }).tts.ttsRate).toBe(1.6)
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

  it('passes through notify.enabled and notify.speakAloud booleans', () => {
    const normalized = normalizeCompanionSettings({ notify: { enabled: false, speakAloud: false } })
    expect(normalized.notify.enabled).toBe(false)
    expect(normalized.notify.speakAloud).toBe(false)
  })

  it('ignores the retired notify.speak flag so speaking aloud stays on by default', () => {
    expect(normalizeCompanionSettings({ notify: { speak: false } }).notify.speakAloud).toBe(true)
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
    expect(normalizeCompanionSettings({ tts: { provider: 'qwen3' } }).tts.provider).toBe('qwen3')
    expect(normalizeCompanionSettings({ tts: { provider: 'eleven-labs' } }).tts.provider).toBe(
      getDefaultCompanionSettings().tts.provider
    )
  })

  it('keeps a known Qwen3 emotion and resets an unknown one to the default', () => {
    expect(normalizeCompanionSettings({ tts: { qwenEmotion: 'warm' } }).tts.qwenEmotion).toBe(
      'warm'
    )
    expect(normalizeCompanionSettings({ tts: { qwenEmotion: 'angry' } }).tts.qwenEmotion).toBe(
      'neutral'
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
    expect(wake).toEqual({
      enabled: true,
      phrases: ['Пятница'],
      followUpMs: 30_000,
      keywordSpotter: false
    })
    expect(normalizeCompanionSettings({ wake: { phrases: [] } }).wake.phrases).toEqual(['джарвис'])
    expect(normalizeCompanionSettings({ wake: { followUpMs: -5 } }).wake.followUpMs).toBe(0)
  })

  it('keeps only usable end keywords and clamps the fallback pause', () => {
    const endKeyword = normalizeCompanionSettings({
      endKeyword: { enabled: true, words: [' Думай ', '', '...', 3], fallbackPauseSeconds: 90 }
    }).endKeyword
    expect(endKeyword).toEqual({ enabled: true, words: ['Думай'], fallbackPauseSeconds: 30 })
    const repaired = normalizeCompanionSettings({
      endKeyword: { enabled: 'yes', words: [], fallbackPauseSeconds: 0 }
    }).endKeyword
    expect(repaired).toEqual({
      ...getDefaultCompanionSettings().endKeyword,
      fallbackPauseSeconds: 1
    })
  })

  it('clamps voiceFocus numeric fields and validates strictness', () => {
    const voiceFocus = normalizeCompanionSettings({
      voiceFocus: {
        enabled: true,
        endOfUtteranceSeconds: 100,
        maxUtteranceSeconds: 1,
        denoiserEnabled: 'yes',
        strictness: 'extreme',
        showDropped: 'yes'
      }
    }).voiceFocus
    expect(voiceFocus).toEqual({
      enabled: true,
      endOfUtteranceSeconds: 5,
      maxUtteranceSeconds: 10,
      denoiserEnabled: getDefaultCompanionSettings().voiceFocus.denoiserEnabled,
      strictness: getDefaultCompanionSettings().voiceFocus.strictness,
      showDropped: getDefaultCompanionSettings().voiceFocus.showDropped
    })
  })

  it('defaults a missing voiceFocus block entirely', () => {
    expect(normalizeCompanionSettings({}).voiceFocus).toEqual(
      getDefaultCompanionSettings().voiceFocus
    )
  })
})
