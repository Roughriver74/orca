import { describe, expect, it } from 'vitest'
import { isCompanionUtteranceDangling } from './companion-utterance-dangling'

describe('isCompanionUtteranceDangling', () => {
  it('flags text trailing on a comma, colon, semicolon, or dash', () => {
    expect(isCompanionUtteranceDangling('Я хотел сказать,')).toBe(true)
    expect(isCompanionUtteranceDangling('Короче говоря —')).toBe(true)
    expect(isCompanionUtteranceDangling('Смотри:')).toBe(true)
    expect(isCompanionUtteranceDangling('Погоди;')).toBe(true)
    expect(isCompanionUtteranceDangling('Погоди -')).toBe(true)
  })

  it('flags a dangling trailing conjunction, preposition, or particle with no punctuation', () => {
    expect(isCompanionUtteranceDangling('Я пошёл в')).toBe(true)
    expect(isCompanionUtteranceDangling('Это было потому что')).toBe(true)
    expect(isCompanionUtteranceDangling('Сделай коммит и')).toBe(true)
    expect(isCompanionUtteranceDangling('Открой файл но')).toBe(true)
    expect(isCompanionUtteranceDangling('Запусти тесты если')).toBe(true)
    expect(isCompanionUtteranceDangling('Ну вот')).toBe(true)
    expect(isCompanionUtteranceDangling('Это как бы типа')).toBe(true)
  })

  it('does not flag a sentence that ends with a terminator, even "и всё."', () => {
    expect(isCompanionUtteranceDangling('Сделал коммит и всё.')).toBe(false)
    expect(isCompanionUtteranceDangling('Привет, как дела?')).toBe(false)
    expect(isCompanionUtteranceDangling('Отлично!')).toBe(false)
  })

  it('does not flag an abbreviation ending the sentence', () => {
    expect(isCompanionUtteranceDangling('Там было много дел и т.д.')).toBe(false)
    expect(isCompanionUtteranceDangling('Короче, и т.п.')).toBe(false)
  })

  it('does not flag a complete utterance with no trailing punctuation', () => {
    expect(isCompanionUtteranceDangling('Я живу в Москве')).toBe(false)
    expect(isCompanionUtteranceDangling('Запусти тесты')).toBe(false)
  })

  it('treats ё and plain е in the trailing word the same', () => {
    expect(isCompanionUtteranceDangling('Это всё')).toBe(false)
  })

  it('is case-insensitive for the trailing word', () => {
    expect(isCompanionUtteranceDangling('Открой файл И')).toBe(true)
  })

  it('ignores blank and whitespace-only input', () => {
    expect(isCompanionUtteranceDangling('')).toBe(false)
    expect(isCompanionUtteranceDangling('   ')).toBe(false)
  })
})
