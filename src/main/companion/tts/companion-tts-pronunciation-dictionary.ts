// The user-extendable half of pronunciation: a plain-text file in the companion's home
// directory, one `слово = как читать` pair per line — an English term to transliterate
// (`worktree = вёрктри`) or a Russian word to re-stress (`замок = зам+ок`) — so adding a
// word needs no settings UI and Jarvis's own brain (which runs in that directory) can
// append to it when asked. Re-read only when its mtime/size changes.

import { readFile, stat } from 'node:fs/promises'
import {
  EMPTY_PRONUNCIATION_DICTIONARY,
  type CompanionPronunciationDictionary
} from './companion-tts-latin-transliteration'

export const COMPANION_TTS_PRONUNCIATIONS_FILE_NAME = 'tts-pronunciations.txt'

/** `#` starts a comment; lines without `=`, without a letter in the key, or with an empty value are skipped. */
export function parsePronunciationDictionary(text: string): CompanionPronunciationDictionary {
  const dictionary = new Map<string, string>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/(?:^|\s)#.*$/, '').trim()
    const separator = line.indexOf('=')
    if (separator <= 0) {
      continue
    }
    const key = line.slice(0, separator).trim().toLowerCase().replace(/\s+/g, ' ')
    const value = line.slice(separator + 1).trim()
    if (!/[a-zа-яё]/.test(key) || value === '') {
      continue
    }
    dictionary.set(key, value)
  }
  return dictionary
}

export type CompanionPronunciationFs = {
  stat: (path: string) => Promise<{ mtimeMs: number; size: number }>
  readFile: (path: string) => Promise<string>
}

const defaultFs: CompanionPronunciationFs = {
  stat,
  readFile: (path) => readFile(path, 'utf8')
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  )
}

export function createPronunciationDictionaryLoader(
  fs: CompanionPronunciationFs = defaultFs
): (path: string) => Promise<CompanionPronunciationDictionary> {
  const cache = new Map<
    string,
    { mtimeMs: number; size: number; dictionary: CompanionPronunciationDictionary }
  >()
  return async (path) => {
    try {
      const { mtimeMs, size } = await fs.stat(path)
      const cached = cache.get(path)
      if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
        return cached.dictionary
      }
      const dictionary = parsePronunciationDictionary(await fs.readFile(path))
      cache.set(path, { mtimeMs, size, dictionary })
      return dictionary
    } catch (error) {
      cache.delete(path)
      if (!isMissingFileError(error)) {
        // Why not throw: a broken dictionary must never silence the reply itself.
        console.warn('[companion] could not read the TTS pronunciation dictionary', error)
      }
      return EMPTY_PRONUNCIATION_DICTIONARY
    }
  }
}

export const loadCompanionPronunciationDictionary = createPronunciationDictionaryLoader()
