// Expands every digit sequence in speech text into Russian words: case follows the
// preceding preposition, gender and number follow the counted noun. Silero drops digits
// outright (see companion-tts-number-words-ru.ts), so nothing numeric may survive.

import {
  DEGREE_NOUN_RU,
  DOLLAR_NOUN_RU,
  EURO_NOUN_RU,
  PERCENT_NOUN_RU,
  RUBLE_NOUN_RU,
  nounGenderRu
} from './companion-tts-counted-nouns-ru'
import {
  expandMonthYears,
  expandNumericDates,
  expandTextDates,
  expandTimes,
  expandYears
} from './companion-tts-date-expansion-ru'
import {
  PREPOSITION_CASES,
  caseAfterPreposition,
  followingWord,
  precedingWord,
  sentenceEndAfterAbbreviation
} from './companion-tts-number-context-ru'
import {
  BILLION_NOUN_RU,
  MILLION_NOUN_RU,
  THOUSAND_NOUN_RU,
  agreeNounRu,
  cardinalRu,
  decimalRu,
  type RuCase,
  type RuGender,
  type RuNoun
} from './companion-tts-number-words-ru'
import { ordinalRu, type RuAgreement } from './companion-tts-ordinal-words-ru'

const ORDINAL_SUFFIX_FORMS: Record<string, { agreement: RuAgreement; grammaticalCase: RuCase }> = {
  й: { agreement: 'm', grammaticalCase: 'nom' },
  ый: { agreement: 'm', grammaticalCase: 'nom' },
  ий: { agreement: 'm', grammaticalCase: 'nom' },
  я: { agreement: 'f', grammaticalCase: 'nom' },
  ая: { agreement: 'f', grammaticalCase: 'nom' },
  ья: { agreement: 'f', grammaticalCase: 'nom' },
  е: { agreement: 'n', grammaticalCase: 'nom' },
  ое: { agreement: 'n', grammaticalCase: 'nom' },
  ье: { agreement: 'n', grammaticalCase: 'nom' },
  го: { agreement: 'm', grammaticalCase: 'gen' },
  ого: { agreement: 'm', grammaticalCase: 'gen' },
  ьего: { agreement: 'm', grammaticalCase: 'gen' },
  му: { agreement: 'm', grammaticalCase: 'dat' },
  ому: { agreement: 'm', grammaticalCase: 'dat' },
  ьему: { agreement: 'm', grammaticalCase: 'dat' },
  м: { agreement: 'm', grammaticalCase: 'ins' },
  ым: { agreement: 'm', grammaticalCase: 'ins' },
  ом: { agreement: 'm', grammaticalCase: 'ins' },
  ьим: { agreement: 'm', grammaticalCase: 'ins' },
  ьем: { agreement: 'm', grammaticalCase: 'prep' },
  х: { agreement: 'pl', grammaticalCase: 'gen' },
  ых: { agreement: 'pl', grammaticalCase: 'gen' },
  ьих: { agreement: 'pl', grammaticalCase: 'gen' },
  ми: { agreement: 'pl', grammaticalCase: 'ins' },
  ыми: { agreement: 'pl', grammaticalCase: 'ins' },
  ьими: { agreement: 'pl', grammaticalCase: 'ins' },
  ю: { agreement: 'f', grammaticalCase: 'acc' },
  ую: { agreement: 'f', grammaticalCase: 'acc' },
  ью: { agreement: 'f', grammaticalCase: 'acc' },
  // "5-ой строки"; for stressed stems the masculine nominative ("2-ой") is the same word.
  ой: { agreement: 'f', grammaticalCase: 'gen' },
  ей: { agreement: 'f', grammaticalCase: 'gen' },
  ьи: { agreement: 'pl', grammaticalCase: 'nom' }
}
const LOCATIVE_PREPOSITIONS: Record<string, true> = {
  в: true,
  во: true,
  на: true,
  о: true,
  об: true,
  обо: true,
  при: true
}
const ORDINAL_SUFFIX_PATTERN = new RegExp(
  String.raw`(?<![\d.,])(\d+)-(${Object.keys(ORDINAL_SUFFIX_FORMS)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?!\p{L})`,
  'gu'
)

/** "1-й", "3-я", "2024-м", "90-х" → declined ordinals. */
function expandOrdinalSuffixes(text: string): string {
  return text.replace(
    ORDINAL_SUFFIX_PATTERN,
    (match: string, digits: string, suffix: string, offset: number, full: string) => {
      const value = Number(digits)
      const form = ORDINAL_SUFFIX_FORMS[suffix]
      if (!Number.isSafeInteger(value) || !form) {
        return match
      }
      let { agreement, grammaticalCase } = form
      const preposition = precedingWord(full, offset)
      if (
        grammaticalCase === 'ins' &&
        agreement === 'm' &&
        preposition &&
        preposition in LOCATIVE_PREPOSITIONS
      ) {
        grammaticalCase = 'prep'
      }
      if (
        agreement === 'n' &&
        followingWord(full.slice(offset + match.length))?.startsWith('год')
      ) {
        agreement = 'pl'
      }
      return ordinalRu(value, agreement, grammaticalCase)
    }
  )
}

const VERSION_PATTERN = /(?<![\d.,])\d+(?:\.\d+){2,}(?!\d)/g

/** "1.2.3" → "один точка два точка три" (otherwise "1.2" would read as a decimal). */
function expandVersions(text: string): string {
  return text.replace(VERSION_PATTERN, (match) =>
    match
      .split('.')
      .map((part) => cardinalRu(Number(part)))
      .join(' точка ')
  )
}

const SCALE_ABBREVIATIONS: Record<string, RuNoun> = {
  тыс: THOUSAND_NOUN_RU,
  млн: MILLION_NOUN_RU,
  млрд: BILLION_NOUN_RU
}
const UNIT_SYMBOLS: Record<string, RuNoun> = {
  '%': PERCENT_NOUN_RU,
  '₽': RUBLE_NOUN_RU,
  руб: RUBLE_NOUN_RU,
  р: RUBLE_NOUN_RU,
  $: DOLLAR_NOUN_RU,
  '€': EURO_NOUN_RU,
  '°': DEGREE_NOUN_RU
}

type Quantity = { integer: number; fraction?: string; scale?: RuNoun; unit?: RuNoun }

function spellNumber(quantity: Quantity, grammaticalCase: RuCase, gender: RuGender): string {
  return quantity.fraction === undefined
    ? cardinalRu(quantity.integer, gender, { grammaticalCase, omitLeadingOne: true })
    : decimalRu(quantity.integer, quantity.fraction, grammaticalCase)
}

/** Gender the numeral agrees with: its scale/unit noun, else the noun written after it. */
function countedGender(quantity: Quantity, nextWord: string | undefined): RuGender {
  return (quantity.scale ?? quantity.unit)?.gender ?? nounGenderRu(nextWord)
}

/** A number plus its optional scale/unit abbreviations, declined and agreed in one case. */
function spellQuantity(
  quantity: Quantity,
  grammaticalCase: RuCase,
  nextWord: string | undefined
): string {
  const { scale, unit } = quantity
  const words = [spellNumber(quantity, grammaticalCase, countedGender(quantity, nextWord))]
  const counted = scale ?? unit
  if (counted) {
    words.push(
      agreeNounRu(counted, quantity.integer, grammaticalCase, quantity.fraction !== undefined)
    )
  }
  if (scale && unit) {
    // After a scale word the currency is always genitive plural ("двух тысяч рублей").
    words.push(unit.plural[1])
  }
  return words.join(' ')
}

// Groups: dollar prefix, integer (optionally space-grouped by thousands), fraction digits,
// scale abbreviation, unit symbol/abbreviation.
const QUANTITY_SOURCE = String.raw`(\$\s?)?(\d{1,3}(?:[ \u00A0]\d{3})+(?!\d)|\d+)(?:[.,](\d+))?(?:\s?((?:тыс|млн|млрд)\.?(?!\p{L})))?(?:\s?(%|₽|\$|€|°|руб\.?(?!\p{L})|р\.))?`
const RANGE_PATTERN = new RegExp(
  String.raw`(?<![\d.,:])(\d+)(?:[.,](\d+))?\s?[–—-]\s?${QUANTITY_SOURCE}`,
  'gu'
)
const QUANTITY_PATTERN = new RegExp(
  String.raw`(?<![\d.,])(?:(?<=^|[\s(])([-−]))?${QUANTITY_SOURCE}`,
  'gu'
)

function quantityFromGroups(
  dollar: string | undefined,
  digits: string,
  fraction: string | undefined,
  scale: string | undefined,
  unit: string | undefined
): Quantity {
  const unitKey = dollar ? '$' : unit?.replace('.', '').toLowerCase()
  return {
    integer: Number(digits.replace(/[ \u00A0]/g, '')),
    fraction,
    scale: scale ? SCALE_ABBREVIATIONS[scale.replace('.', '').toLowerCase()] : undefined,
    unit: unitKey ? UNIT_SYMBOLS[unitKey] : undefined
  }
}

/** "5–10 минут" → "от пяти до десяти минут"; after a preposition both ends take its case. */
function expandRanges(text: string): string {
  return text.replace(
    RANGE_PATTERN,
    (
      match: string,
      startDigits: string,
      startFraction: string | undefined,
      dollar: string | undefined,
      digits: string,
      fraction: string | undefined,
      scale: string | undefined,
      unit: string | undefined,
      offset: number,
      full: string
    ) => {
      const end = quantityFromGroups(dollar, digits, fraction, scale, unit)
      if (!Number.isSafeInteger(end.integer)) {
        return match
      }
      const rest = full.slice(offset + match.length)
      const nextWord = followingWord(rest)
      const start: Quantity = { integer: Number(startDigits), fraction: startFraction }
      const preposition = precedingWord(full, offset)
      const inPreposition = preposition !== undefined && preposition in PREPOSITION_CASES
      const grammaticalCase = inPreposition
        ? caseAfterPreposition(preposition, nextWord, end.integer)
        : 'gen'
      // The start shares the end's counted noun for gender ("от одной до двух минут").
      const startWords = spellNumber(start, grammaticalCase, countedGender(end, nextWord))
      const endWords =
        spellQuantity(end, grammaticalCase, nextWord) + sentenceEndAfterAbbreviation(match, rest)
      return inPreposition ? `${startWords} ${endWords}` : `от ${startWords} до ${endWords}`
    }
  )
}

/** Remaining numbers, with case from the preceding preposition and gender from the counted noun. */
function expandQuantities(text: string): string {
  return text.replace(
    QUANTITY_PATTERN,
    (
      match: string,
      minus: string | undefined,
      dollar: string | undefined,
      digits: string,
      fraction: string | undefined,
      scale: string | undefined,
      unit: string | undefined,
      offset: number,
      full: string
    ) => {
      const quantity = quantityFromGroups(dollar, digits, fraction, scale, unit)
      if (!Number.isSafeInteger(quantity.integer)) {
        return match
      }
      const rest = full.slice(offset + match.length)
      const nextWord = followingWord(rest)
      const grammaticalCase = caseAfterPreposition(
        precedingWord(full, offset),
        nextWord,
        quantity.integer
      )
      const words = spellQuantity(quantity, grammaticalCase, nextWord)
      return (minus ? 'минус ' : '') + words + sentenceEndAfterAbbreviation(match, rest)
    }
  )
}

/** Expands dates, times, ordinals, ranges and remaining numbers into spoken Russian words.
 *  Order matters: each pass consumes digits the more generic later passes would misread. */
export function expandNumbers(text: string): string {
  return [
    expandNumericDates,
    expandTextDates,
    expandMonthYears,
    expandYears,
    expandTimes,
    expandOrdinalSuffixes,
    expandVersions,
    expandRanges,
    expandQuantities
  ].reduce((result, pass) => pass(result), text.replace(/№\s?/g, 'номер '))
}
