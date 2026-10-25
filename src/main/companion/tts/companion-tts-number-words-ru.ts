// Russian number-to-words for speech normalization. Silero v5_4_ru's symbol table is
// Cyrillic-letters-only (see snakers4/silero-models README "Supported alphabets"); its
// text preprocessing strips any character outside that set before synthesis, so digits
// are silently dropped rather than spoken. Measured against the lab venv: "21 октября в
// 14:30, бюджет 1 250 000 рублей." produced 2.08s of audio versus 5.41s for the fully
// spelled-out equivalent — confirming digits are not expanded internally. Everything
// here must run before text reaches the sidecar.

export type RuGender = 'm' | 'f' | 'n'
export type RuCase = 'nom' | 'gen' | 'dat' | 'acc' | 'ins' | 'prep'

/** Word forms in case order: nominative, genitive, dative, accusative, instrumental, prepositional. */
export type CaseForms = readonly [string, string, string, string, string, string]

export const CASE_INDEX: Record<RuCase, number> = {
  nom: 0,
  gen: 1,
  dat: 2,
  acc: 3,
  ins: 4,
  prep: 5
}

const ONE: Record<RuGender, CaseForms> = {
  m: ['один', 'одного', 'одному', 'один', 'одним', 'одном'],
  f: ['одна', 'одной', 'одной', 'одну', 'одной', 'одной'],
  n: ['одно', 'одного', 'одному', 'одно', 'одним', 'одном']
}

/** Numerals ending in a soft sign ("пять", "одиннадцать", "двадцать") share one paradigm. */
function softNumeral(nominative: string): CaseForms {
  const stem = nominative.slice(0, -1)
  return [nominative, `${stem}и`, `${stem}и`, nominative, `${stem}ью`, `${stem}и`]
}

/** 2-19; index 0-1 are handled by `ONE`/zero. */
const SMALL: readonly CaseForms[] = [
  ['ноль', 'нуля', 'нулю', 'ноль', 'нулём', 'нуле'],
  ONE.m,
  ['два', 'двух', 'двум', 'два', 'двумя', 'двух'],
  ['три', 'трёх', 'трём', 'три', 'тремя', 'трёх'],
  ['четыре', 'четырёх', 'четырём', 'четыре', 'четырьмя', 'четырёх'],
  softNumeral('пять'),
  softNumeral('шесть'),
  softNumeral('семь'),
  ['восемь', 'восьми', 'восьми', 'восемь', 'восемью', 'восьми'],
  softNumeral('девять'),
  softNumeral('десять'),
  softNumeral('одиннадцать'),
  softNumeral('двенадцать'),
  softNumeral('тринадцать'),
  softNumeral('четырнадцать'),
  softNumeral('пятнадцать'),
  softNumeral('шестнадцать'),
  softNumeral('семнадцать'),
  softNumeral('восемнадцать'),
  softNumeral('девятнадцать')
]

const TENS: readonly (CaseForms | null)[] = [
  null,
  null,
  softNumeral('двадцать'),
  softNumeral('тридцать'),
  ['сорок', 'сорока', 'сорока', 'сорок', 'сорока', 'сорока'],
  ['пятьдесят', 'пятидесяти', 'пятидесяти', 'пятьдесят', 'пятьюдесятью', 'пятидесяти'],
  ['шестьдесят', 'шестидесяти', 'шестидесяти', 'шестьдесят', 'шестьюдесятью', 'шестидесяти'],
  ['семьдесят', 'семидесяти', 'семидесяти', 'семьдесят', 'семьюдесятью', 'семидесяти'],
  ['восемьдесят', 'восьмидесяти', 'восьмидесяти', 'восемьдесят', 'восемьюдесятью', 'восьмидесяти'],
  ['девяносто', 'девяноста', 'девяноста', 'девяносто', 'девяноста', 'девяноста']
]

/** "пятьсот" → "пятисот", "пятистам", "пятьюстами", "пятистах" from the ones-word paradigm. */
function hundredsFromOnes(ones: CaseForms): CaseForms {
  const [nom, gen, , , ins] = ones
  return [`${nom}сот`, `${gen}сот`, `${gen}стам`, `${nom}сот`, `${ins}стами`, `${gen}стах`]
}

const HUNDREDS: readonly (CaseForms | null)[] = [
  null,
  ['сто', 'ста', 'ста', 'сто', 'ста', 'ста'],
  ['двести', 'двухсот', 'двумстам', 'двести', 'двумястами', 'двухстах'],
  ['триста', 'трёхсот', 'трёмстам', 'триста', 'тремястами', 'трёхстах'],
  ['четыреста', 'четырёхсот', 'четырёмстам', 'четыреста', 'четырьмястами', 'четырёхстах'],
  hundredsFromOnes(SMALL[5]),
  hundredsFromOnes(SMALL[6]),
  hundredsFromOnes(SMALL[7]),
  hundredsFromOnes(SMALL[8]),
  hundredsFromOnes(SMALL[9])
]

/** A counted noun: singular and plural paradigms; `paucal` overrides the "2-4" nominative form
 *  (adjectival nouns: "две целых", not "две целой"). */
export type RuNoun = {
  gender: RuGender
  singular: CaseForms
  plural: CaseForms
  paucal?: string
}

/** Hard-stem masculine noun whose plural follows "-ов/-ам/-ами/-ах" ("миллион", "процент"). */
export function hardNoun(
  gender: RuGender,
  stem: string,
  singular: CaseForms,
  pluralNom: string
): RuNoun {
  return {
    gender,
    singular,
    plural: [pluralNom, `${stem}ов`, `${stem}ам`, pluralNom, `${stem}ами`, `${stem}ах`]
  }
}

function adjectivalFeminineNoun(stem: string): RuNoun {
  return {
    gender: 'f',
    singular: [`${stem}ая`, `${stem}ой`, `${stem}ой`, `${stem}ую`, `${stem}ой`, `${stem}ой`],
    plural: [`${stem}ые`, `${stem}ых`, `${stem}ым`, `${stem}ые`, `${stem}ыми`, `${stem}ых`],
    paucal: `${stem}ых`
  }
}

export const THOUSAND_NOUN_RU: RuNoun = {
  gender: 'f',
  singular: ['тысяча', 'тысячи', 'тысяче', 'тысячу', 'тысячей', 'тысяче'],
  plural: ['тысячи', 'тысяч', 'тысячам', 'тысячи', 'тысячами', 'тысячах']
}
export const MILLION_NOUN_RU = hardNoun(
  'm',
  'миллион',
  ['миллион', 'миллиона', 'миллиону', 'миллион', 'миллионом', 'миллионе'],
  'миллионы'
)
export const BILLION_NOUN_RU = hardNoun(
  'm',
  'миллиард',
  ['миллиард', 'миллиарда', 'миллиарду', 'миллиард', 'миллиардом', 'миллиарде'],
  'миллиарды'
)
const TRILLION_NOUN_RU = hardNoun(
  'm',
  'триллион',
  ['триллион', 'триллиона', 'триллиону', 'триллион', 'триллионом', 'триллионе'],
  'триллионы'
)
const SCALE_NOUNS: readonly RuNoun[] = [
  THOUSAND_NOUN_RU,
  MILLION_NOUN_RU,
  BILLION_NOUN_RU,
  TRILLION_NOUN_RU
]

const WHOLE_NOUN = adjectivalFeminineNoun('цел')
const FRACTION_DENOMINATORS = [
  'десят',
  'сот',
  'тысячн',
  'десятитысячн',
  'стотысячн',
  'миллионн'
].map(adjectivalFeminineNoun)

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

/** True when a count takes the singular in oblique cases ("двадцати одной тысячи"). */
export function endsInOneRu(n: number): boolean {
  return n % 10 === 1 && n % 100 !== 11
}

/** Noun form after a count: nominative/accusative pick 1 / 2-4 / 5+ forms; other cases
 *  follow the whole numeral in singular (ends in 1) or plural. Fractions govern genitive singular. */
export function agreeNounRu(
  noun: RuNoun,
  count: number,
  grammaticalCase: RuCase = 'nom',
  fractional = false
): string {
  const caseIndex = CASE_INDEX[grammaticalCase]
  if (fractional) {
    return noun.singular[CASE_INDEX.gen]
  }
  const n = Math.trunc(Math.abs(count))
  if (grammaticalCase === 'nom' || grammaticalCase === 'acc') {
    const form = pluralFormIndex(n)
    if (form === 0) {
      return noun.singular[caseIndex]
    }
    return form === 1 ? (noun.paucal ?? noun.singular[CASE_INDEX.gen]) : noun.plural[CASE_INDEX.gen]
  }
  return endsInOneRu(n) ? noun.singular[caseIndex] : noun.plural[caseIndex]
}

function onesWord(digit: number, gender: RuGender, caseIndex: number): string {
  if (digit === 1) {
    return ONE[gender][caseIndex]
  }
  if (digit === 2 && gender === 'f' && (caseIndex === 0 || caseIndex === 3)) {
    return 'две'
  }
  return SMALL[digit][caseIndex]
}

/** Converts 1-999 to words in the given case, declining the ones word for the given gender. */
function convertGroup(n: number, gender: RuGender, caseIndex: number): string[] {
  const words: string[] = []
  const hundreds = HUNDREDS[Math.floor(n / 100)]
  const rest = n % 100
  if (hundreds) {
    words.push(hundreds[caseIndex])
  }
  if (rest >= 10 && rest <= 19) {
    words.push(SMALL[rest][caseIndex])
    return words
  }
  const tens = TENS[Math.floor(rest / 10)]
  if (tens) {
    words.push(tens[caseIndex])
  }
  if (rest % 10 > 0) {
    words.push(onesWord(rest % 10, gender, caseIndex))
  }
  return words
}

export type CardinalOptions = {
  grammaticalCase?: RuCase
  /** Speech form "тысяча пятьсот" instead of "одна тысяча пятьсот". */
  omitLeadingOne?: boolean
}

/** Cardinal number in words. `gender` applies to the trailing ones-word only. */
export function cardinalRu(
  value: number,
  gender: RuGender = 'm',
  options: CardinalOptions = {}
): string {
  if (!Number.isFinite(value)) {
    return String(value)
  }
  const caseIndex = CASE_INDEX[options.grammaticalCase ?? 'nom']
  const negative = value < 0
  let n = Math.trunc(Math.abs(value))
  if (n === 0) {
    return (negative ? 'минус ' : '') + SMALL[0][caseIndex]
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
    if (scaleIndex === 0) {
      words.push(...convertGroup(groupValue, gender, caseIndex))
      continue
    }
    const scale = SCALE_NOUNS[scaleIndex - 1]
    if (!scale) {
      // Beyond trillions: fall back to digits rather than drop the magnitude silently.
      words.push(String(groupValue), 'умножить на 10 в степени', String(scaleIndex * 3))
      continue
    }
    const isTopGroup = scaleIndex === groups.length - 1
    if (!(options.omitLeadingOne && isTopGroup && scaleIndex === 1 && groupValue === 1)) {
      words.push(...convertGroup(groupValue, scale.gender, caseIndex))
    }
    words.push(agreeNounRu(scale, groupValue, options.grammaticalCase))
  }
  return (negative ? 'минус ' : '') + words.join(' ')
}

const MAX_SPOKEN_FRACTION_DIGITS = FRACTION_DENOMINATORS.length

/** Decimal fraction read as Russian does: "2,5" → "две целых пять десятых", declined throughout. */
export function decimalRu(
  integer: number,
  fractionDigits: string,
  grammaticalCase: RuCase = 'nom'
): string {
  const options: CardinalOptions = { grammaticalCase, omitLeadingOne: true }
  if (fractionDigits.length > MAX_SPOKEN_FRACTION_DIGITS) {
    const digits = [...fractionDigits].map((digit) => cardinalRu(Number(digit)))
    return `${cardinalRu(integer, 'm', options)} точка ${digits.join(' ')}`
  }
  const numerator = Number(fractionDigits)
  const denominator = FRACTION_DENOMINATORS[fractionDigits.length - 1]
  return [
    cardinalRu(integer, 'f', options),
    agreeNounRu(WHOLE_NOUN, integer, grammaticalCase),
    cardinalRu(numerator, 'f', options),
    agreeNounRu(denominator, numerator, grammaticalCase)
  ].join(' ')
}

/** Hour:minute read as two cardinal groups ("14:30" → "четырнадцать тридцать", "14:05" → "четырнадцать ноль пять"). */
export function timeOfDayRu(hour: number, minute: number, grammaticalCase: RuCase = 'nom'): string {
  const hourWords = cardinalRu(hour, 'm', { grammaticalCase })
  if (minute === 0) {
    return `${hourWords} ноль ноль`
  }
  const minuteWords = cardinalRu(minute, 'f', { grammaticalCase })
  return minute < 10 ? `${hourWords} ноль ${minuteWords}` : `${hourWords} ${minuteWords}`
}
