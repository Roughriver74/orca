import { describe, expect, it } from 'vitest'
import { applyRussianPronunciations } from './companion-tts-russian-pronunciations'

describe('applyRussianPronunciations', () => {
  it('re-stresses whole words case-insensitively, leaving longer words alone', () => {
    const dictionary = new Map([['замок', 'зам+ок']])
    expect(
      applyRussianPronunciations('Замок сломан, ЗАМОК-то новый, замочек цел.', dictionary)
    ).toBe('зам+ок сломан, зам+ок-то новый, замочек цел.')
  })

  it('prefers a phrase over the single word it starts with', () => {
    const dictionary = new Map([
      ['замок', 'зам+ок'],
      ['замок на горе', 'з+амок на гор+е']
    ])
    expect(applyRussianPronunciations('Замок на  горе, а на двери замок.', dictionary)).toBe(
      'з+амок на гор+е, а на двери зам+ок.'
    )
  })

  it('treats ё and е as the same letter in keys and text', () => {
    const dictionary = new Map([
      ['ёжик', '+ёжик'],
      ['елка', '+ёлка']
    ])
    expect(applyRussianPronunciations('Ежик под ёлкой, ёлка стоит.', dictionary)).toBe(
      '+ёжик под ёлкой, +ёлка стоит.'
    )
  })

  it('ignores Latin keys, which the transliteration pass owns', () => {
    const dictionary = new Map([['commit', 'коммит']])
    expect(applyRussianPronunciations('Сделал commit.', dictionary)).toBe('Сделал commit.')
  })
})
