// Grammatical context around a number in running text: which case the preceding
// preposition demands and which noun follows. Shared by the date and number expansion passes.

import { endsInOneRu, type RuCase } from './companion-tts-number-words-ru'

// Case each preposition governs on a following numeral. "с", "в"/"во", "на" and "по" are
// refined from the counted noun / count in `caseAfterPreposition`.
export const PREPOSITION_CASES: Record<string, RuCase> = {
  из: 'gen',
  изо: 'gen',
  'из-за': 'gen',
  до: 'gen',
  от: 'gen',
  ото: 'gen',
  без: 'gen',
  безо: 'gen',
  для: 'gen',
  у: 'gen',
  около: 'gen',
  после: 'gen',
  кроме: 'gen',
  вокруг: 'gen',
  против: 'gen',
  среди: 'gen',
  вместо: 'gen',
  возле: 'gen',
  ради: 'gen',
  более: 'gen',
  менее: 'gen',
  больше: 'gen',
  меньше: 'gen',
  свыше: 'gen',
  порядка: 'gen',
  выше: 'gen',
  ниже: 'gen',
  с: 'gen',
  со: 'gen',
  к: 'dat',
  ко: 'dat',
  благодаря: 'dat',
  согласно: 'dat',
  вопреки: 'dat',
  над: 'ins',
  надо: 'ins',
  перед: 'ins',
  передо: 'ins',
  между: 'ins',
  о: 'prep',
  об: 'prep',
  обо: 'prep',
  при: 'prep',
  в: 'acc',
  во: 'acc',
  на: 'acc',
  по: 'acc',
  за: 'acc',
  про: 'acc',
  через: 'acc',
  сквозь: 'acc',
  спустя: 'acc'
}
const INSTRUMENTAL_NOUN_ENDING = /(?:ами|ями|ом|ем|ём|ой|ей|ью)$/
const PREPOSITIONAL_PLURAL_ENDING = /[ая]х$/

export function precedingWord(text: string, offset: number): string | undefined {
  return /([\p{L}-]+)\s+$/u.exec(text.slice(Math.max(0, offset - 40), offset))?.[1]?.toLowerCase()
}

export function followingWord(rest: string): string | undefined {
  return /^\s*(\p{L}+)/u.exec(rest)?.[1]?.toLowerCase()
}

/** Case of a numeral after `preposition`; ambiguous prepositions look at the counted noun. */
export function caseAfterPreposition(
  preposition: string | undefined,
  nextWord: string | undefined,
  count: number
): RuCase {
  if (!preposition) {
    return 'nom'
  }
  switch (preposition) {
    case 'с':
    case 'со':
      // "с 2 файлами" vs "с 10 до 12" / "с 9 утра".
      return nextWord && INSTRUMENTAL_NOUN_ENDING.test(nextWord) ? 'ins' : 'gen'
    case 'в':
    case 'во':
    case 'на':
      // "в 3 файлах" / "в 1 файле" vs "в 2 раза" / "на 5 минут".
      return nextWord &&
        (PREPOSITIONAL_PLURAL_ENDING.test(nextWord) ||
          (endsInOneRu(count) && /[еи]$/.test(nextWord)))
        ? 'prep'
        : 'acc'
    case 'по':
      // Distributive "по": dative for one ("по одной"), accusative otherwise ("по две штуки").
      return endsInOneRu(count) ? 'dat' : 'acc'
    default:
      return PREPOSITION_CASES[preposition] ?? 'nom'
  }
}

/** An abbreviation's dot doubles as the sentence end when nothing or a capitalized word follows. */
export function sentenceEndAfterAbbreviation(consumed: string, rest: string): string {
  return consumed.endsWith('.') && /^(?:\s*$|\s+\p{Lu})/u.test(rest) ? '.' : ''
}
