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
      brainModel: 'opus',
      launchAtLogin: true,
      tts: { ttsEnabled: false, ttsVoice: 'baya', ttsRate: 1.25 },
      notify: { enabled: false, quietFrom: '23:00', quietTo: '07:30', speak: true }
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
      notify: { enabled: 'yes', quietFrom: '25:99', quietTo: 42, speak: 'no' }
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
})
