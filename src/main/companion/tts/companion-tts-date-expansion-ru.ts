// Speech expansion passes for dates, years and clock times. They run before the generic
// number pass in companion-tts-number-expansion-ru.ts, which would otherwise read
// "21 октября" or "2024 году" as plain cardinals.

import {
  PREPOSITION_CASES,
  caseAfterPreposition,
  precedingWord,
  sentenceEndAfterAbbreviation
} from './companion-tts-number-context-ru'
import { timeOfDayRu, type RuCase } from './companion-tts-number-words-ru'
import { MONTH_GENITIVE_RU, ordinalRu } from './companion-tts-ordinal-words-ru'

const MONTH_PATTERN = MONTH_GENITIVE_RU.join('|')

function spokenDate(
  day: number,
  monthIndex: number,
  year: number | undefined,
  dayCase: RuCase
): string {
  const words = [ordinalRu(day, 'n', dayCase), MONTH_GENITIVE_RU[monthIndex]]
  if (year !== undefined) {
    words.push(ordinalRu(year, 'm', 'gen'), 'года')
  }
  return words.join(' ')
}

/** Dates read in genitive ("21 октября") unless a preposition demands otherwise ("к 21", "по 12"). */
function dateCase(preposition: string | undefined): RuCase {
  if (preposition === 'по' || preposition === 'на') {
    return 'acc'
  }
  return preposition === 'к' || preposition === 'ко' ? 'dat' : 'gen'
}

const NUMERIC_DATE_PATTERN =
  /(?<![\d.])(?:(\d{1,2})\.(\d{1,2})\.(\d{4})|(\d{4})-(\d{2})-(\d{2}))(?!\d)(?:\s*(?:года|г\.)(?!\p{L}))?/gu

/** "25.10.2026" / "2026-10-25" → "двадцать пятого октября две тысячи двадцать шестого года". */
export function expandNumericDates(text: string): string {
  return text.replace(
    NUMERIC_DATE_PATTERN,
    (match, ...args: [...(string | undefined)[], number, string]) => {
      const [dmyDay, dmyMonth, dmyYear, isoYear, isoMonth, isoDay] = args
      const offset = Number(args.at(-2))
      const full = String(args.at(-1))
      const day = Number(dmyDay ?? isoDay)
      const month = Number(dmyMonth ?? isoMonth)
      if (day < 1 || day > 31 || month < 1 || month > 12) {
        return match
      }
      const rest = full.slice(offset + match.length)
      const date = spokenDate(
        day,
        month - 1,
        Number(dmyYear ?? isoYear),
        dateCase(precedingWord(full, offset))
      )
      return date + sentenceEndAfterAbbreviation(match, rest)
    }
  )
}

// `\b` is ASCII-only in JS (Cyrillic letters are not `\w`), so Cyrillic boundaries use
// `\p{L}` lookarounds instead.
const TEXT_DATE_PATTERN = new RegExp(
  String.raw`(?<!\p{L})(?:(с|со|от)\s+(\d{1,2})\s+(по|до)\s+)?(?<![\d.,])(\d{1,2})(?:\s?[–—-]\s?(\d{1,2}))?\s+(${MONTH_PATTERN})(?!\p{L})(?:\s+(\d{4})(?!\d)(?:\s*(?:года|г\.)(?!\p{L}))?)?`,
  'giu'
)

/** "21 октября", "с 10 по 12 октября", "10–12 мая", "к 5 июня 2026 г." with ordinal days. */
export function expandTextDates(text: string): string {
  return text.replace(
    TEXT_DATE_PATTERN,
    (
      match: string,
      fromPreposition: string | undefined,
      fromDay: string | undefined,
      rangeWord: string | undefined,
      day: string,
      rangeEndDay: string | undefined,
      month: string,
      year: string | undefined,
      offset: number,
      full: string
    ) => {
      const monthIndex = MONTH_GENITIVE_RU.indexOf(month.toLowerCase())
      const yearValue = year === undefined ? undefined : Number(year)
      const tail = sentenceEndAfterAbbreviation(match, full.slice(offset + match.length))
      if (fromPreposition && fromDay && rangeWord) {
        const endCase = rangeWord.toLowerCase() === 'по' ? 'acc' : 'gen'
        const start = ordinalRu(Number(fromDay), 'n', 'gen')
        const end = spokenDate(Number(day), monthIndex, yearValue, endCase)
        return `${fromPreposition} ${start} ${rangeWord} ${end}${tail}`
      }
      const preposition = precedingWord(full, offset)
      const dayCase = dateCase(preposition)
      if (rangeEndDay === undefined) {
        return spokenDate(Number(day), monthIndex, yearValue, dayCase) + tail
      }
      if (preposition !== undefined && preposition in PREPOSITION_CASES) {
        const end = spokenDate(Number(rangeEndDay), monthIndex, yearValue, dayCase)
        return `${ordinalRu(Number(day), 'n', dayCase)} ${end}${tail}`
      }
      const end = spokenDate(Number(rangeEndDay), monthIndex, yearValue, 'acc')
      return `с ${ordinalRu(Number(day), 'n', 'gen')} по ${end}${tail}`
    }
  )
}

const MONTH_YEAR_PATTERN =
  /(?<!\p{L})((?:январ|феврал|март|апрел|июн|июл|август|сентябр|октябр|ноябр|декабр)\p{L}*|ма[йяею])(?!\p{L})\s+(\d{4})(?!\d)(?:\s*(?:года|г\.)(?!\p{L}))?/giu

/** "в октябре 2025" → "в октябре две тысячи двадцать пятого года". */
export function expandMonthYears(text: string): string {
  return text.replace(
    MONTH_YEAR_PATTERN,
    (match: string, month: string, year: string, offset: number, full: string) =>
      `${month} ${ordinalRu(Number(year), 'm', 'gen')} года${sentenceEndAfterAbbreviation(match, full.slice(offset + match.length))}`
  )
}

const YEAR_NOUN_FORMS: Record<RuCase, string> = {
  nom: 'год',
  gen: 'года',
  dat: 'году',
  acc: 'год',
  ins: 'годом',
  prep: 'году'
}
const YEARS_NOUN_FORMS: Record<RuCase, string> = {
  nom: 'годы',
  gen: 'годов',
  dat: 'годам',
  acc: 'годы',
  ins: 'годами',
  prep: 'годах'
}
const YEAR_NOUN_CASES: Record<string, RuCase> = {
  год: 'nom',
  года: 'gen',
  году: 'prep',
  годом: 'ins',
  годе: 'prep',
  годы: 'nom',
  годов: 'gen',
  годам: 'dat',
  годами: 'ins',
  годах: 'prep'
}
const YEAR_PREPOSITION_CASES: Record<string, RuCase> = {
  ...PREPOSITION_CASES,
  в: 'prep',
  во: 'prep'
}
const YEAR_PATTERN =
  /(?<!\p{L})(?:(с|со|от)\s+(\d{4})\s+(по|до)\s+)?(?<![\d.,])(\d{4})(?:\s?[–—-]\s?(\d{4}))?(?:-\p{L}{1,3})?\s+(год(?:ами|ам|ах|ов|ом|а|у|е|ы)?|гг?\.)(?!\p{L})/giu

/** "в 2024 году", "2020–2022 годах", "с 2020 по 2022 год", "в 2025 г." → ordinal years. */
export function expandYears(text: string): string {
  return text.replace(
    YEAR_PATTERN,
    (
      match: string,
      fromPreposition: string | undefined,
      fromYear: string | undefined,
      rangeWord: string | undefined,
      year: string,
      rangeEndYear: string | undefined,
      noun: string,
      offset: number,
      full: string
    ) => {
      const lowerNoun = noun.toLowerCase()
      const preposition = precedingWord(full, offset)
      let grammaticalCase: RuCase
      let spokenNoun: string
      if (lowerNoun.startsWith('г') && lowerNoun.endsWith('.')) {
        grammaticalCase = (preposition && YEAR_PREPOSITION_CASES[preposition]) || 'nom'
        const forms = lowerNoun === 'гг.' ? YEARS_NOUN_FORMS : YEAR_NOUN_FORMS
        spokenNoun = forms[grammaticalCase]
      } else {
        const nounCase = YEAR_NOUN_CASES[lowerNoun]
        grammaticalCase =
          lowerNoun === 'году' && (preposition === 'к' || preposition === 'ко') ? 'dat' : nounCase
        spokenNoun = noun
      }
      const tail = sentenceEndAfterAbbreviation(match, full.slice(offset + match.length))
      const years = [ordinalRu(Number(year), 'm', grammaticalCase)]
      if (rangeEndYear !== undefined) {
        years.push(ordinalRu(Number(rangeEndYear), 'm', grammaticalCase))
      }
      const spoken = `${years.join(' ')} ${spokenNoun}${tail}`
      if (fromPreposition && fromYear && rangeWord) {
        return `${fromPreposition} ${ordinalRu(Number(fromYear), 'm', 'gen')} ${rangeWord} ${spoken}`
      }
      return spoken
    }
  )
}

const TIME_SOURCE = String.raw`([01]?\d|2[0-3]):([0-5]\d)`
const TIME_PATTERN = new RegExp(
  String.raw`(?<![\d:])${TIME_SOURCE}(?:\s?[–—-]\s?${TIME_SOURCE})?(?![\d:])`,
  'g'
)

/** "в 14:30", "до 18:00", "9:00–18:00" (→ "с девяти ноль ноль до восемнадцати ноль ноль"). */
export function expandTimes(text: string): string {
  return text.replace(
    TIME_PATTERN,
    (
      _match: string,
      hour: string,
      minute: string,
      endHour: string | undefined,
      endMinute: string | undefined,
      offset: number,
      full: string
    ) => {
      const preposition = precedingWord(full, offset)
      const grammaticalCase = caseAfterPreposition(preposition, undefined, Number(hour))
      if (endHour === undefined || endMinute === undefined) {
        return timeOfDayRu(Number(hour), Number(minute), grammaticalCase)
      }
      if (preposition !== undefined && preposition in PREPOSITION_CASES) {
        return `${timeOfDayRu(Number(hour), Number(minute), grammaticalCase)} ${timeOfDayRu(Number(endHour), Number(endMinute), grammaticalCase)}`
      }
      return `с ${timeOfDayRu(Number(hour), Number(minute), 'gen')} до ${timeOfDayRu(Number(endHour), Number(endMinute), 'gen')}`
    }
  )
}
