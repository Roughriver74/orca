import { describe, expect, it } from 'vitest'
import {
  MONTH_GENITIVE_RU,
  cardinalRu,
  ordinalDayGenitiveRu,
  timeOfDayRu
} from './companion-tts-number-words-ru'

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
