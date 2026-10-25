// The Russian half of the user's tts-pronunciations.txt: Cyrillic keys fix words the
// engines stress or read wrong — homographs (`замок = зам+ок`) or whole phrases
// (`замок на воротах = зам+ок на вор+отах`). `+` before the stressed vowel is stress
// markup both Silero and Yandex SpeechKit (API v1 `text` and API v3) understand.

import { escapeRegex } from '../../../shared/string-utils'
import {
  isLatinPronunciationKey,
  type CompanionPronunciationDictionary
} from './companion-tts-latin-transliteration'

// A reply may spell `ё` as `е` and vice versa; keys and matches are compared folded.
function foldYo(text: string): string {
  return text.replace(/ё/g, 'е')
}

function normalizeKey(text: string): string {
  return foldYo(text.toLowerCase().replace(/\s+/g, ' '))
}

function keyPattern(key: string): string {
  return escapeRegex(key).replace(/ /g, '\\s+').replace(/е/g, '[её]')
}

/** Replaces whole-word, case-insensitive matches of the dictionary's Russian keys, longest first. */
export function applyRussianPronunciations(
  text: string,
  dictionary: CompanionPronunciationDictionary
): string {
  const replacements = new Map<string, string>()
  for (const [key, value] of dictionary) {
    if (!isLatinPronunciationKey(key)) {
      replacements.set(normalizeKey(key), value)
    }
  }
  if (replacements.size === 0) {
    return text
  }
  // Longest first so a phrase wins over the single word it starts with.
  const alternatives = [...replacements.keys()].sort((a, b) => b.length - a.length).map(keyPattern)
  const pattern = new RegExp(`(?<!\\p{L})(?:${alternatives.join('|')})(?!\\p{L})`, 'giu')
  return text.replace(pattern, (match) => replacements.get(normalizeKey(match)) ?? match)
}
