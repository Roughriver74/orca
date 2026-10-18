// Silero's Russian models only know Cyrillic letters (their symbol table is
// `_~|!+,-.:;?абв…яё–… `): Latin words in a reply — commit, worktree, Claude — are
// silently dropped, so Jarvis skips exactly the terms a developer cares about. This
// rewrites every Latin run into Cyrillic before synthesis, in priority order:
//   1. the user's pronunciation dictionary (tts-pronunciations.txt in the companion home),
//   2. the built-in dev/product terms in companion-tts-latin-lexicon.ts,
//   3. letter-by-letter spelling for acronyms (API, SSH, npm),
//   4. rule-based English→Russian phonetic transliteration for everything else.

import { BUILTIN_PRONUNCIATIONS, LETTER_NAMES } from './companion-tts-latin-lexicon'

/** Lowercased Latin word or phrase → how to say it in Cyrillic. */
export type CompanionPronunciationDictionary = ReadonlyMap<string, string>

export const EMPTY_PRONUNCIATION_DICTIONARY: CompanionPronunciationDictionary = new Map()

const SINGLE_LETTER_SOUNDS: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'дж',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  y: 'и',
  z: 'з'
}

// Longest-first letter clusters with a fixed Russian rendering wherever they appear.
const CLUSTER_SOUNDS: [string, string][] = [
  ['tion', 'шн'],
  ['sion', 'жн'],
  ['dge', 'дж'],
  ['igh', 'ай'],
  ['sch', 'ск'],
  ['tch', 'ч'],
  ['sh', 'ш'],
  ['ch', 'ч'],
  ['th', 'т'],
  ['ph', 'ф'],
  ['wh', 'у'],
  ['ck', 'к'],
  ['qu', 'кв'],
  ['ee', 'и'],
  ['ea', 'и'],
  ['oo', 'у'],
  ['ou', 'ау'],
  ['ow', 'оу'],
  ['oa', 'оу'],
  ['ai', 'ей'],
  ['ay', 'ей'],
  ['ey', 'ей'],
  ['ei', 'ей'],
  ['oi', 'ой'],
  ['oy', 'ой'],
  ['au', 'о'],
  ['aw', 'о'],
  ['ew', 'ью']
]

// Vowel before consonant + silent final `e` ("make", "time", "type") reads long.
const LONG_VOWEL_SOUNDS: Record<string, string> = {
  a: 'ей',
  e: 'и',
  i: 'ай',
  o: 'оу',
  u: 'ю',
  y: 'ай'
}

const VOWELS = 'aeiouy'

function isVowel(char: string | undefined): boolean {
  return char !== undefined && VOWELS.includes(char)
}

function isConsonant(char: string | undefined): boolean {
  return char !== undefined && /[a-z]/.test(char) && !isVowel(char)
}

function spellLetters(word: string): string {
  return Array.from(word.toLowerCase(), (char) => LETTER_NAMES[char] ?? char).join(' ')
}

function isAcronym(word: string): boolean {
  if (word.length === 1) {
    return true
  }
  const allCaps = word === word.toUpperCase() && word.length <= 6
  const noVowels = !/[aeiouy]/i.test(word)
  return allCaps || noVowels
}

/** Phonetic best effort for a lowercase English word nobody put in a dictionary. */
function transliterateWord(word: string): string {
  const magicE = /([aeiouy])([b-df-hj-np-tv-z])e$/.exec(word)
  const longVowelAt = magicE && word.length >= 4 ? magicE.index : -1
  const body = longVowelAt >= 0 ? word.slice(0, -1) : word
  let out = ''
  let i = 0
  while (i < body.length) {
    if (i === longVowelAt) {
      out += LONG_VOWEL_SOUNDS[body[i]]
      i += 1
      continue
    }
    if (i === 0 && (body.startsWith('kn') || body.startsWith('wr'))) {
      i += 1
      continue
    }
    const cluster = CLUSTER_SOUNDS.find(([letters]) => body.startsWith(letters, i))
    if (cluster) {
      out += cluster[1]
      i += cluster[0].length
      continue
    }
    const char = body[i]
    const next = body[i + 1]
    if (char === 'c') {
      out += next === 'e' || next === 'i' || next === 'y' ? 'с' : 'к'
    } else if (char === 'y' && i === 0 && isVowel(next)) {
      out += 'й'
    } else if (char === 'e' && i === 0) {
      out += 'э'
    } else if (
      char === 'u' &&
      isConsonant(next) &&
      (isConsonant(body[i + 2]) || i + 2 >= body.length)
    ) {
      out += 'а'
    } else if (char === 'u' && i === 0) {
      out += 'ю'
    } else if (char === 'e' && i === body.length - 1 && body.length > 2) {
      // Silent final `e` ("engine", "core").
    } else {
      out += SINGLE_LETTER_SOUNDS[char] ?? ''
    }
    i += 1
  }
  return out
}

function lookup(word: string, user: CompanionPronunciationDictionary): string | undefined {
  const key = word.toLowerCase()
  return user.get(key) ?? BUILTIN_PRONUNCIATIONS[key]
}

function speakWord(word: string, user: CompanionPronunciationDictionary): string {
  const known = lookup(word, user)
  if (known !== undefined) {
    return known
  }
  return isAcronym(word) ? spellLetters(word) : transliterateWord(word.toLowerCase())
}

const CAMEL_CASE_BOUNDARY = /(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/
const LETTER_DIGIT_BOUNDARY = /(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/

/** One Latin token (`GitHub`, `useAudioCapture`, `gpt-4o`, `index.ts`) → Cyrillic words. */
function speakToken(token: string, user: CompanionPronunciationDictionary): string {
  const known = lookup(token, user)
  if (known !== undefined) {
    return known
  }
  const parts = token.split(/[._'’-]+/).filter((part) => part.length > 0)
  if (parts.length > 1) {
    return parts.map((part) => speakToken(part, user)).join(' ')
  }
  return token
    .split(LETTER_DIGIT_BOUNDARY)
    .flatMap((piece) => (/^\d+$/.test(piece) ? [piece] : piece.split(CAMEL_CASE_BOUNDARY)))
    .map((piece) => (/^\d+$/.test(piece) ? piece : speakWord(piece, user)))
    .join(' ')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function phrasePattern(user: CompanionPronunciationDictionary): RegExp | null {
  const phrases = [...Object.keys(BUILTIN_PRONUNCIATIONS), ...user.keys()]
    .filter((key) => key.includes(' '))
    .sort((a, b) => b.length - a.length)
  if (phrases.length === 0) {
    return null
  }
  const alternatives = phrases.map((phrase) => escapeRegExp(phrase).replace(/ /g, '\\s+'))
  return new RegExp(`(?<![A-Za-z])(?:${alternatives.join('|')})(?![A-Za-z])`, 'gi')
}

// A Latin run with inner separators, plus an optional `'`/`-` gluing it to a Russian
// ending ("worktree'ов", "commit-ы") — the glue is dropped so the word reads as one.
const LATIN_TOKEN = /([A-Za-z][A-Za-z0-9]*(?:[._'’-][A-Za-z0-9]+)*)(['’-](?=[а-яё]))?/gi

/** Rewrites every Latin word/phrase in `text` into Cyrillic Silero can pronounce. */
export function transliterateLatinForSpeech(
  text: string,
  user: CompanionPronunciationDictionary = EMPTY_PRONUNCIATION_DICTIONARY
): string {
  if (!/[A-Za-z]/.test(text)) {
    return text
  }
  const phrases = phrasePattern(user)
  const withPhrases = phrases
    ? text.replace(phrases, (match) => lookup(match.replace(/\s+/g, ' '), user) ?? match)
    : text
  return withPhrases.replace(LATIN_TOKEN, (_match, token: string) => speakToken(token, user))
}
