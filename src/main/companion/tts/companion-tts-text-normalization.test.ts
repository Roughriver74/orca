import { describe, expect, it } from 'vitest'
import { normalizeForSpeech } from './companion-tts-text-normalization'

describe('normalizeForSpeech', () => {
  it('strips headings, bullets, and bold while keeping the words', () => {
    expect(normalizeForSpeech('# Заголовок\n\n- пункт один\n- пункт два')).toBe(
      'Заголовок пункт один пункт два'
    )
    expect(normalizeForSpeech('Это **важно** и ещё раз __важно__.')).toBe(
      'Это важно и ещё раз важно.'
    )
  })

  it('drops fenced code blocks and tables entirely', () => {
    const text =
      'Смотри код:\n```js\nconst x = 1\n```\nи таблицу:\n| a | b |\n| - | - |\n| 1 | 2 |\nГотово.'
    const result = normalizeForSpeech(text)
    expect(result).not.toContain('const x')
    expect(result).not.toContain('|')
    expect(result).toBe('Смотри код: и таблицу: Готово.')
  })

  it('converts links to their text and unwraps short inline code, dropping long code', () => {
    expect(normalizeForSpeech('См. [документацию](https://example.com/docs).')).toBe(
      'См. документацию.'
    )
    expect(normalizeForSpeech('Запусти `pnpm test`.')).toBe('Запусти пи эн пи эм тест.')
    const longCode = 'a'.repeat(30)
    expect(normalizeForSpeech(`Код: \`${longCode}\` готов.`)).toBe('Код: готов.')
  })

  it('replaces bare URLs and filesystem paths with spoken placeholders', () => {
    expect(normalizeForSpeech('Открой https://example.com/page сейчас.')).toBe(
      'Открой ссылка в панели сейчас.'
    )
    expect(normalizeForSpeech('Файл лежит в /Users/evgenijsikunov/assistant/ideas/note.md.')).toBe(
      'Файл лежит в путь в панели.'
    )
    expect(normalizeForSpeech('Путь C:\\Users\\e\\file.txt сохранён.')).toBe(
      'Путь путь в панели сохранён.'
    )
  })

  it('keeps Silero single-asterisk intonation markers intact', () => {
    expect(normalizeForSpeech('Ты *сегодня* хочешь закончить отчёт?')).toBe(
      'Ты *сегодня* хочешь закончить отчёт?'
    )
    expect(normalizeForSpeech('**Важно**: ты *сегодня* готов?')).toBe('Важно: ты *сегодня* готов?')
  })

  it('expands the acceptance numbers_dates sentence with correct grammatical case', () => {
    expect(normalizeForSpeech('Встреча 21 октября в 14:30, бюджет 1 250 000 рублей.')).toBe(
      'Встреча двадцать первого октября в четырнадцать тридцать, бюджет один миллион двести пятьдесят тысяч рублей.'
    )
  })

  it('expands a simple counted noun with feminine agreement', () => {
    expect(normalizeForSpeech('Жди 2 минуты.')).toBe('Жди две минуты.')
    expect(normalizeForSpeech('Осталось 5 яблок.')).toBe('Осталось пять яблок.')
  })

  it('collapses whitespace left behind by stripped markup', () => {
    expect(normalizeForSpeech('# Заголовок\n\n\nТекст   с   пробелами.')).toBe(
      'Заголовок Текст с пробелами.'
    )
  })
})
