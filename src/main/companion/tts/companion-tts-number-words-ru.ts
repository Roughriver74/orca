// Russian number-to-words for speech normalization. Silero v5_4_ru's symbol table is
// Cyrillic-letters-only (see snakers4/silero-models README "Supported alphabets"); its
// text preprocessing strips any character outside that set before synthesis, so digits
// are silently dropped rather than spoken. Measured against the lab venv: "21 октября в
// 14:30, бюджет 1 250 000 рублей." produced 2.08s of audio versus 5.41s for the fully
// spelled-out equivalent — confirming digits are not expanded internally. Everything
// here must run before text reaches the sidecar.

export type RuGender = 'm' | 'f' | 'n'

const ONES: Record<RuGender, readonly string[]> = {
  m: ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  f: ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
  n: ['', 'одно', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
}
const TEENS = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать'
]
const TENS = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто'
]
const HUNDREDS = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот'
]

/** (nominative singular, nominative plural "2-4", genitive plural "5+", gender of the group's own ones-word). */
type Scale = { forms: readonly [string, string, string]; gender: RuGender }
const SCALES: readonly Scale[] = [
  { forms: ['', '', ''], gender: 'm' }, // units: no scale word
  { forms: ['тысяча', 'тысячи', 'тысяч'], gender: 'f' },
  { forms: ['миллион', 'миллиона', 'миллионов'], gender: 'm' },
  { forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 'm' },
  { forms: ['триллион', 'триллиона', 'триллионов'], gender: 'm' }
]

/** Russian plural-form index: 0 = "1", 1 = "2-4", 2 = "0,5-20,25-30...". */
function pluralFormIndex(n: number): 0 | 1 | 2 {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) {
    return 2
  }
  const mod10 = n % 10
  if (mod10 === 1) {
    return 0
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 1
  }
  return 2
}

/** Converts 0-999 to words, declining the ones word for the given gender. */
function convertGroup(n: number, gender: RuGender): string[] {
  const words: string[] = []
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds > 0) {
    words.push(HUNDREDS[hundreds])
  }
  if (rest >= 10 && rest <= 19) {
    words.push(TEENS[rest - 10])
  } else {
    const tens = Math.floor(rest / 10)
    const ones = rest % 10
    if (tens > 0) {
      words.push(TENS[tens])
    }
    if (ones > 0) {
      words.push(ONES[gender][ones])
    }
  }
  return words
}

/** Cardinal number in words, nominative case. `gender` applies to the trailing ones-word only. */
export function cardinalRu(value: number, gender: RuGender = 'm'): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  if (value === 0) {
    return 'ноль'
  }
  const negative = value < 0
  let n = Math.trunc(Math.abs(value))
  if (n === 0) {
    return negative ? 'минус ноль' : 'ноль'
  }

  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }

  const words: string[] = []
  for (let scaleIndex = groups.length - 1; scaleIndex >= 0; scaleIndex--) {
    const groupValue = groups[scaleIndex]
    if (groupValue === 0) {
      continue
    }
    const scale = SCALES[scaleIndex]
    if (!scale) {
      // Beyond trillions: fall back to digits rather than drop the magnitude silently.
      words.push(String(groupValue), 'умножить на 10 в степени', String(scaleIndex * 3))
      continue
    }
    const groupGender = scaleIndex === 0 ? gender : scale.gender
    words.push(...convertGroup(groupValue, groupGender))
    if (scaleIndex > 0) {
      words.push(scale.forms[pluralFormIndex(groupValue)])
    }
  }
  return (negative ? 'минус ' : '') + words.join(' ')
}

const ORDINAL_DAY_GENITIVE: Record<number, string> = {
  1: 'первого',
  2: 'второго',
  3: 'третьего',
  4: 'четвёртого',
  5: 'пятого',
  6: 'шестого',
  7: 'седьмого',
  8: 'восьмого',
  9: 'девятого',
  10: 'десятого',
  11: 'одиннадцатого',
  12: 'двенадцатого',
  13: 'тринадцатого',
  14: 'четырнадцатого',
  15: 'пятнадцатого',
  16: 'шестнадцатого',
  17: 'семнадцатого',
  18: 'восемнадцатого',
  19: 'девятнадцатого',
  20: 'двадцатого',
  30: 'тридцатого'
}

/** Day-of-month (1-31) in genitive ordinal form, as Russian dates are read ("21" → "двадцать первого").
 *  Only the final component of a compound ordinal declines; leading tens stay cardinal. */
export function ordinalDayGenitiveRu(day: number): string {
  const exact = ORDINAL_DAY_GENITIVE[day]
  if (exact) {
    return exact
  }
  if (day > 20 && day < 30) {
    return `двадцать ${ORDINAL_DAY_GENITIVE[day - 20]}`
  }
  if (day === 31) {
    return `тридцать ${ORDINAL_DAY_GENITIVE[1]}`
  }
  return String(day)
}

export const MONTH_GENITIVE_RU: readonly string[] = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

/** Hour:minute read as two cardinal groups ("14:30" → "четырнадцать тридцать", "14:05" → "четырнадцать ноль пять"). */
export function timeOfDayRu(hour: number, minute: number): string {
  const hourWords = cardinalRu(hour)
  if (minute === 0) {
    return `${hourWords} ноль ноль`
  }
  const minuteWords = minute < 10 ? `ноль ${cardinalRu(minute)}` : cardinalRu(minute)
  return `${hourWords} ${minuteWords}`
}
