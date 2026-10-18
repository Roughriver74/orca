import { describe, expect, it } from 'vitest'
import { transliterateLatinForSpeech } from './companion-tts-latin-transliteration'
import { normalizeForSpeech } from './companion-tts-text-normalization'

describe('transliterateLatinForSpeech', () => {
  it('reads common dev terms from the built-in dictionary', () => {
    expect(transliterateLatinForSpeech('Сделал commit в worktree, Claude доволен.')).toBe(
      'Сделал коммит в ворктри, клод доволен.'
    )
  })

  it('matches multi-word phrases before single words, case-insensitively', () => {
    expect(transliterateLatinForSpeech('Открыл Pull Request через Claude Code.')).toBe(
      'Открыл пул реквест через клод код.'
    )
  })

  it('lets the user dictionary override and extend the built-in one', () => {
    const user = new Map([
      ['worktree', 'вёрктри'],
      ['orca ide', 'орка ай ди и']
    ])
    expect(transliterateLatinForSpeech('Новый worktree в Orca IDE.', user)).toBe(
      'Новый вёрктри в орка ай ди и.'
    )
  })

  it('glues a Russian ending onto the transliterated word', () => {
    expect(transliterateLatinForSpeech("Пять worktree'ов и два commit-а.")).toBe(
      'Пять ворктриов и два коммита.'
    )
  })

  it('spells acronyms letter by letter', () => {
    expect(transliterateLatinForSpeech('HTTP и AWS')).toBe('эйч ти ти пи и эй дабл ю эс')
  })

  it('splits camelCase and dotted identifiers into words', () => {
    expect(transliterateLatinForSpeech('Флаг darkMode в index.ts')).toBe(
      'Флаг дарк моуд в индекс ти эс'
    )
  })

  it('falls back to phonetic rules for words nobody listed', () => {
    expect(transliterateLatinForSpeech('shell speech check make sandbox')).toBe(
      'шелл спич чек мейк сандбокс'
    )
  })

  it('leaves Cyrillic-only text and Silero intonation markers alone', () => {
    expect(transliterateLatinForSpeech('Всё *готово*.')).toBe('Всё *готово*.')
    expect(transliterateLatinForSpeech('Сделал *commit*.')).toBe('Сделал *коммит*.')
  })
})

describe('normalizeForSpeech with Latin words', () => {
  it('exposes digits inside Latin tokens to number expansion', () => {
    expect(normalizeForSpeech('Модель GPT-4 готова.')).toBe('Модель джи пи ти четыре готова.')
  })

  it('applies the user dictionary passed in options', () => {
    expect(
      normalizeForSpeech('Запусти **lint**.', { pronunciations: new Map([['lint', 'линтер']]) })
    ).toBe('Запусти линтер.')
  })
})
