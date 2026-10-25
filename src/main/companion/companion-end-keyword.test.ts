import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionEndKeywordSettings } from '../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../shared/constants'
import { createCompanionEndKeywordBuffer, stripCompanionEndKeyword } from './companion-end-keyword'

const DEFAULT_WORDS = getDefaultCompanionSettings().endKeyword.words

describe('stripCompanionEndKeyword', () => {
  it.each([
    ['Сделай отчёт по продажам думай', 'Сделай отчёт по продажам'],
    ['Сделай отчёт, думай.', 'Сделай отчёт'],
    ['Сделай отчёт. Думай!', 'Сделай отчёт.'],
    ['Сделай отчёт — ДАВАЙ?', 'Сделай отчёт'],
    ['Проверь тесты, все', 'Проверь тесты'],
    ['Проверь тесты. Всё...', 'Проверь тесты.'],
    ['думай', '']
  ])('strips the trailing keyword from %j', (text, expected) => {
    expect(stripCompanionEndKeyword(text, DEFAULT_WORDS)).toBe(expected)
  })

  it('ignores a keyword that is not the last word', () => {
    expect(stripCompanionEndKeyword('давай посмотрим на логи', DEFAULT_WORDS)).toBeNull()
    expect(stripCompanionEndKeyword('я думаю', DEFAULT_WORDS)).toBeNull()
  })

  it('matches multi-word keywords and prefers the longest one', () => {
    expect(stripCompanionEndKeyword('Вот задача. На этом всё.', ['всё', 'на этом всё'])).toBe(
      'Вот задача.'
    )
  })
})

describe('createCompanionEndKeywordBuffer', () => {
  let settings: CompanionEndKeywordSettings
  const sent: string[] = []

  function createBuffer() {
    return createCompanionEndKeywordBuffer({
      getSettings: () => settings,
      onFallback: (text) => sent.push(text)
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    settings = { ...getDefaultCompanionSettings().endKeyword, enabled: true }
    sent.length = 0
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accumulates segments until one ends on a keyword, then sends them without it', () => {
    const buffer = createBuffer()
    expect(buffer.push('Хочу, чтобы ты')).toBeNull()
    expect(buffer.push('посмотрел логи сборки')).toBeNull()
    expect(buffer.isPending()).toBe(true)
    expect(buffer.push('и нашёл ошибку. Думай.')).toBe(
      'Хочу, чтобы ты посмотрел логи сборки и нашёл ошибку.'
    )
    expect(buffer.isPending()).toBe(false)
  })

  it('sends the held request when the keyword comes as its own segment', () => {
    const buffer = createBuffer()
    buffer.push('Почини тест')
    expect(buffer.push('Всё!')).toBe('Почини тест')
  })

  it('treats a lone keyword with nothing held as nothing to send', () => {
    expect(createBuffer().push('давай')).toBeNull()
  })

  it('sends on the fallback pause after the last segment', () => {
    const buffer = createBuffer()
    buffer.push('Почини тест')
    vi.advanceTimersByTime(2000)
    buffer.push('в модуле оплаты')
    vi.advanceTimersByTime(2400)
    expect(sent).toEqual([])
    vi.advanceTimersByTime(100)
    expect(sent).toEqual(['Почини тест в модуле оплаты'])
    expect(buffer.isPending()).toBe(false)
  })

  it('does not run the fallback pause out while the user is still talking', () => {
    const buffer = createBuffer()
    buffer.push('Почини тест')
    buffer.reportUserSpeaking(true)
    vi.advanceTimersByTime(10_000)
    expect(sent).toEqual([])
    buffer.reportUserSpeaking(false)
    vi.advanceTimersByTime(2500)
    expect(sent).toEqual(['Почини тест'])
  })

  it('sends a segment the hotkey finalized as-is, keyword or not', () => {
    const buffer = createBuffer()
    buffer.push('Почини тест')
    buffer.sendNextSegment()
    expect(buffer.push('в модуле оплаты')).toBe('Почини тест в модуле оплаты')
  })

  it('passes every segment straight through while the mode is off', () => {
    settings = { ...settings, enabled: false }
    expect(createBuffer().push('Почини тест думай')).toBe('Почини тест думай')
  })

  it('drops the held request and its timer on clear', () => {
    const buffer = createBuffer()
    buffer.push('Почини тест')
    buffer.clear()
    vi.advanceTimersByTime(10_000)
    expect(sent).toEqual([])
    expect(buffer.take()).toBeNull()
  })
})
