// Russian ordinals for speech normalization (dates, years, "1-й"); split from
// companion-tts-number-words-ru.ts, whose cardinals supply the undeclined head words.

import {
  CASE_INDEX,
  cardinalRu,
  type CaseForms,
  type RuCase,
  type RuGender
} from './companion-tts-number-words-ru'

export type RuAgreement = RuGender | 'pl'

const ORDINAL_ENDINGS: Record<RuAgreement, CaseForms> = {
  m: ['ый', 'ого', 'ому', 'ый', 'ым', 'ом'],
  n: ['ое', 'ого', 'ому', 'ое', 'ым', 'ом'],
  f: ['ая', 'ой', 'ой', 'ую', 'ой', 'ой'],
  pl: ['ые', 'ых', 'ым', 'ые', 'ыми', 'ых']
}
const THIRD: Record<RuAgreement, CaseForms> = {
  m: ['третий', 'третьего', 'третьему', 'третий', 'третьим', 'третьем'],
  n: ['третье', 'третьего', 'третьему', 'третье', 'третьим', 'третьем'],
  f: ['третья', 'третьей', 'третьей', 'третью', 'третьей', 'третьей'],
  pl: ['третьи', 'третьих', 'третьим', 'третьи', 'третьими', 'третьих']
}

/** Ordinal stem of the last numeral component; `stressed` stems end in "-ой" ("второй"). */
type OrdinalStem = { stem: string; stressed?: boolean }
const ORDINAL_STEMS: Record<number, OrdinalStem> = {
  0: { stem: 'нулев', stressed: true },
  1: { stem: 'перв' },
  2: { stem: 'втор', stressed: true },
  4: { stem: 'четвёрт' },
  5: { stem: 'пят' },
  6: { stem: 'шест', stressed: true },
  7: { stem: 'седьм', stressed: true },
  8: { stem: 'восьм', stressed: true },
  9: { stem: 'девят' },
  10: { stem: 'десят' },
  11: { stem: 'одиннадцат' },
  12: { stem: 'двенадцат' },
  13: { stem: 'тринадцат' },
  14: { stem: 'четырнадцат' },
  15: { stem: 'пятнадцат' },
  16: { stem: 'шестнадцат' },
  17: { stem: 'семнадцат' },
  18: { stem: 'восемнадцат' },
  19: { stem: 'девятнадцат' },
  20: { stem: 'двадцат' },
  30: { stem: 'тридцат' },
  40: { stem: 'сороков', stressed: true },
  50: { stem: 'пятидесят' },
  60: { stem: 'шестидесят' },
  70: { stem: 'семидесят' },
  80: { stem: 'восьмидесят' },
  90: { stem: 'девяност' },
  100: { stem: 'сот' },
  200: { stem: 'двухсот' },
  300: { stem: 'трёхсот' },
  400: { stem: 'четырёхсот' },
  500: { stem: 'пятисот' },
  600: { stem: 'шестисот' },
  700: { stem: 'семисот' },
  800: { stem: 'восьмисот' },
  900: { stem: 'девятисот' }
}
const SCALE_ORDINAL_STEMS = ['', 'тысячн', 'миллионн', 'миллиардн']

function declineOrdinalStem(
  { stem, stressed }: OrdinalStem,
  agreement: RuAgreement,
  caseIndex: number
): string {
  const ending = ORDINAL_ENDINGS[agreement][caseIndex]
  return stem + (stressed && ending === 'ый' ? 'ой' : ending)
}

/** "2000" → "двух", "25 000" → "двадцатипяти": genitive count fused into a scale ordinal. */
function scaleOrdinalPrefix(count: number): string {
  if (count === 1) {
    return ''
  }
  if (count === 100) {
    return 'сто'
  }
  return cardinalRu(count, 'n', { grammaticalCase: 'gen' })
    .replace(/одного$/, 'одно')
    .replace(/ /g, '')
}

/** Ordinal in words; only the final component declines ("две тысячи двадцать четвёртом"). */
export function ordinalRu(
  value: number,
  agreement: RuAgreement = 'm',
  grammaticalCase: RuCase = 'nom'
): string {
  const caseIndex = CASE_INDEX[grammaticalCase]
  if (!Number.isSafeInteger(value) || value < 0) {
    return cardinalRu(value)
  }
  if (value === 0) {
    return declineOrdinalStem(ORDINAL_STEMS[0], agreement, caseIndex)
  }
  const belowThousand = value % 1000
  if (belowThousand === 0) {
    let count = value / 1000
    let scaleIndex = 1
    while (count % 1000 === 0 && scaleIndex < SCALE_ORDINAL_STEMS.length - 1) {
      count /= 1000
      scaleIndex++
    }
    if (count >= 1000) {
      return cardinalRu(value)
    }
    const stem = scaleOrdinalPrefix(count) + SCALE_ORDINAL_STEMS[scaleIndex]
    return declineOrdinalStem({ stem }, agreement, caseIndex)
  }
  const rest = belowThousand % 100
  const last = rest === 0 ? belowThousand : rest < 20 ? rest : rest % 10 === 0 ? rest : rest % 10
  const head = value - last
  const lastWord =
    last === 3
      ? THIRD[agreement][caseIndex]
      : declineOrdinalStem(ORDINAL_STEMS[last], agreement, caseIndex)
  return head > 0 ? `${cardinalRu(head, 'm', { omitLeadingOne: true })} ${lastWord}` : lastWord
}

/** Day-of-month (1-31) in genitive ordinal form, as Russian dates are read ("21" → "двадцать первого").
 *  Only the final component of a compound ordinal declines; leading tens stay cardinal. */
export function ordinalDayGenitiveRu(day: number): string {
  return Number.isInteger(day) && day >= 1 && day <= 31 ? ordinalRu(day, 'n', 'gen') : String(day)
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
