// Nouns the speech normalizer counts: unit symbols it expands ("%", "₽", "$") and the
// gender lookup that picks "один/одна/одно", "два/две" for a noun written after a number.

import { hardNoun, type RuGender, type RuNoun } from './companion-tts-number-words-ru'

export const PERCENT_NOUN_RU = hardNoun(
  'm',
  'процент',
  ['процент', 'процента', 'проценту', 'процент', 'процентом', 'проценте'],
  'проценты'
)
export const RUBLE_NOUN_RU: RuNoun = {
  gender: 'm',
  singular: ['рубль', 'рубля', 'рублю', 'рубль', 'рублём', 'рубле'],
  plural: ['рубли', 'рублей', 'рублям', 'рубли', 'рублями', 'рублях']
}
export const DOLLAR_NOUN_RU = hardNoun(
  'm',
  'доллар',
  ['доллар', 'доллара', 'доллару', 'доллар', 'долларом', 'долларе'],
  'доллары'
)
export const EURO_NOUN_RU: RuNoun = {
  gender: 'm',
  singular: ['евро', 'евро', 'евро', 'евро', 'евро', 'евро'],
  plural: ['евро', 'евро', 'евро', 'евро', 'евро', 'евро']
}
export const DEGREE_NOUN_RU = hardNoun(
  'm',
  'градус',
  ['градус', 'градуса', 'градусу', 'градус', 'градусом', 'градусе'],
  'градусы'
)

// Stems of feminine/neuter nouns the assistant counts; anything unknown reads masculine,
// which is also the safe default for "два"/"один" agreement.
const FEMININE_STEMS = [
  'минут',
  'секунд',
  'миллисекунд',
  'недел',
  'тысяч',
  'задач',
  'строк',
  'строчк',
  'ошибк',
  'верси',
  'ветк',
  'вкладк',
  'страниц',
  'копейк',
  'штук',
  'попытк',
  'встреч',
  'заметк',
  'сесси',
  'функци',
  'проблем',
  'книг',
  'част',
  'запис',
  'ноч',
  'модел',
  'команд',
  'программ',
  'систем',
  'категори',
  'позици',
  'сборк',
  'правк',
  'стать',
  'букв',
  'цифр',
  'точк',
  'ссылк',
  'папк',
  'таблиц',
  'колонк',
  'ячейк',
  'библиотек',
  'зависимост',
  'единиц',
  'глав',
  'фраз',
  'кнопк',
  'оценк',
  'звезд',
  'смен',
  'поездк',
  'итераци',
  'операци',
  'транзакци',
  'подписк',
  'заявк',
  'карточк',
  'картинк',
  'фотографи',
  'рекомендаци',
  'компани',
  'сотн',
  'копи',
  'вещ',
  'пачк',
  'порци',
  'чашк',
  'бутылк'
]
const FEMININE_ENDINGS: Record<string, true> = {
  а: true,
  я: true,
  ы: true,
  и: true,
  е: true,
  у: true,
  ю: true,
  ой: true,
  ей: true,
  ою: true,
  ею: true,
  ь: true,
  ью: true
}
const NEUTER_STEMS = [
  'окн',
  'сообщени',
  'мест',
  'письм',
  'слов',
  'изменени',
  'уведомлени',
  'приложени',
  'задани',
  'числ',
  'значени',
  'событи',
  'правил',
  'решени',
  'предложени',
  'услови',
  'упражнени',
  'подключени',
  'обновлени',
  'исправлени',
  'требовани',
  'заняти',
  'яблок',
  'очк'
]
const NEUTER_ENDINGS: Record<string, true> = {
  о: true,
  е: true,
  а: true,
  я: true,
  у: true,
  ю: true,
  ом: true,
  ем: true,
  и: true
}
const NEUTER_INDECLINABLE: Record<string, true> = {
  видео: true,
  аудио: true,
  радио: true,
  кафе: true
}
const GENDERED_STEMS: readonly {
  gender: RuGender
  stems: readonly string[]
  endings: Record<string, true>
}[] = [
  { gender: 'f', stems: FEMININE_STEMS, endings: FEMININE_ENDINGS },
  { gender: 'n', stems: NEUTER_STEMS, endings: NEUTER_ENDINGS }
]

/** Grammatical gender of a counted noun in any case form; masculine when unknown. */
export function nounGenderRu(word: string | undefined): RuGender {
  if (!word) {
    return 'm'
  }
  const lower = word.toLowerCase()
  if (lower in NEUTER_INDECLINABLE) {
    return 'n'
  }
  const match = GENDERED_STEMS.find(({ stems, endings }) =>
    stems.some((stem) => lower.startsWith(stem) && lower.slice(stem.length) in endings)
  )
  return match?.gender ?? 'm'
}
