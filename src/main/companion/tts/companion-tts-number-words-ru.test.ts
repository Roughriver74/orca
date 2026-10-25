import { describe, expect, it } from 'vitest'
import { nounGenderRu } from './companion-tts-counted-nouns-ru'
import { cardinalRu, decimalRu, timeOfDayRu } from './companion-tts-number-words-ru'
import {
  MONTH_GENITIVE_RU,
  ordinalDayGenitiveRu,
  ordinalRu
} from './companion-tts-ordinal-words-ru'

describe('cardinalRu', () => {
  it('spells small numbers', () => {
    expect(cardinalRu(0)).toBe('ноль')
    expect(cardinalRu(5)).toBe('пять')
    expect(cardinalRu(11)).toBe('одиннадцать')
    expect(cardinalRu(21)).toBe('двадцать один')
  })

  it('agrees the trailing ones-word with the requested gender', () => {
    expect(cardinalRu(1, 'm')).toBe('один')
    expect(cardinalRu(1, 'f')).toBe('одна')
    expect(cardinalRu(2, 'f')).toBe('две')
    expect(cardinalRu(21, 'f')).toBe('двадцать одна')
  })

  it('spells hundreds', () => {
    expect(cardinalRu(100)).toBe('сто')
    expect(cardinalRu(345)).toBe('триста сорок пять')
    expect(cardinalRu(999)).toBe('девятьсот девяносто девять')
  })

  it('pluralizes thousands correctly (1/2-4/5+)', () => {
    expect(cardinalRu(1000)).toBe('одна тысяча')
    expect(cardinalRu(2000)).toBe('две тысячи')
    expect(cardinalRu(5000)).toBe('пять тысяч')
    expect(cardinalRu(11000)).toBe('одиннадцать тысяч')
    expect(cardinalRu(21000)).toBe('двадцать одна тысяча')
  })

  it('spells the acceptance money figure (1 250 000 рублей)', () => {
    expect(cardinalRu(1_250_000)).toBe('один миллион двести пятьдесят тысяч')
  })

  it('keeps the units-group gender independent from the thousands-group gender', () => {
    // "одна тысяча двадцать одна" — thousands group is feminine by grammar, units
    // group honors the caller's gender request.
    expect(cardinalRu(1021, 'f')).toBe('одна тысяча двадцать одна')
  })

  it('handles negatives and zero groups', () => {
    expect(cardinalRu(-7)).toBe('минус семь')
    expect(cardinalRu(1_000_000)).toBe('один миллион')
    expect(cardinalRu(100_000)).toBe('сто тысяч')
  })

  it('declines every component in oblique cases', () => {
    expect(cardinalRu(1500, 'm', { grammaticalCase: 'gen', omitLeadingOne: true })).toBe(
      'тысячи пятисот'
    )
    expect(cardinalRu(1500, 'm', { grammaticalCase: 'acc', omitLeadingOne: true })).toBe(
      'тысячу пятьсот'
    )
    expect(cardinalRu(2348, 'm', { grammaticalCase: 'ins' })).toBe(
      'двумя тысячами тремястами сорока восемью'
    )
    expect(cardinalRu(21, 'f', { grammaticalCase: 'dat' })).toBe('двадцати одной')
    expect(cardinalRu(999_999, 'm', { grammaticalCase: 'prep' })).toBe(
      'девятистах девяноста девяти тысячах девятистах девяноста девяти'
    )
  })
})

describe('decimalRu', () => {
  it('reads integer and fractional parts with feminine agreement', () => {
    expect(decimalRu(1, '5')).toBe('одна целая пять десятых')
    expect(decimalRu(0, '25', 'gen')).toBe('нуля целых двадцати пяти сотых')
    expect(decimalRu(3, '001')).toBe('три целых одна тысячная')
  })
})

describe('ordinalRu', () => {
  it('declines only the last component, including round thousands', () => {
    expect(ordinalRu(2024, 'm', 'prep')).toBe('две тысячи двадцать четвёртом')
    expect(ordinalRu(1990, 'pl', 'gen')).toBe('тысяча девятьсот девяностых')
    expect(ordinalRu(2000)).toBe('двухтысячный')
    expect(ordinalRu(3, 'f', 'acc')).toBe('третью')
    expect(ordinalRu(40)).toBe('сороковой')
    expect(ordinalRu(112, 'n', 'nom')).toBe('сто двенадцатое')
  })
})

describe('nounGenderRu', () => {
  it('recognizes feminine and neuter nouns in any case form, masculine otherwise', () => {
    expect(nounGenderRu('минуту')).toBe('f')
    expect(nounGenderRu('строкой')).toBe('f')
    expect(nounGenderRu('сообщение')).toBe('n')
    expect(nounGenderRu('файлов')).toBe('m')
    expect(nounGenderRu(undefined)).toBe('m')
  })
})

describe('ordinalDayGenitiveRu', () => {
  it('keeps leading tens cardinal and declines only the last component', () => {
    expect(ordinalDayGenitiveRu(1)).toBe('первого')
    expect(ordinalDayGenitiveRu(20)).toBe('двадцатого')
    expect(ordinalDayGenitiveRu(21)).toBe('двадцать первого')
    expect(ordinalDayGenitiveRu(30)).toBe('тридцатого')
    expect(ordinalDayGenitiveRu(31)).toBe('тридцать первого')
  })
})

describe('MONTH_GENITIVE_RU', () => {
  it('has 12 months with october at index 9', () => {
    expect(MONTH_GENITIVE_RU).toHaveLength(12)
    expect(MONTH_GENITIVE_RU[9]).toBe('октября')
  })
})

describe('timeOfDayRu', () => {
  it('reads hour and minute as two cardinal groups', () => {
    expect(timeOfDayRu(14, 30)).toBe('четырнадцать тридцать')
    expect(timeOfDayRu(9, 5)).toBe('девять ноль пять')
    expect(timeOfDayRu(0, 0)).toBe('ноль ноль ноль')
  })
})
