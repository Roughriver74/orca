// Turns a brain reply (markdown-flavored Claude text) into something Silero can speak
// sensibly. Silero's symbol table is Cyrillic-letters-only — digits, markdown syntax,
// and most punctuation beyond `.,!?-` are silently dropped during its own preprocessing
// rather than spoken, so stripping/expanding them here is required, not cosmetic (see
// companion-tts-number-words-ru.ts for the measured evidence on digits).
//
// Single-asterisk pairs (`*word*`) are Silero's own intonation-centre markup — the brain
// is told to emit them for stressed words — so every step here is written to leave a
// lone `*...*` span untouched while still stripping markdown's double-asterisk bold.

import { expandNumbers } from './companion-tts-number-expansion-ru'
import {
  EMPTY_PRONUNCIATION_DICTIONARY,
  transliterateLatinForSpeech,
  type CompanionPronunciationDictionary
} from './companion-tts-latin-transliteration'
import { applyRussianPronunciations } from './companion-tts-russian-pronunciations'

const INLINE_CODE_DROP_THRESHOLD = 20

/** Drops fenced code blocks and pipe tables wholesale — neither reads sensibly aloud. */
function dropCodeBlocksAndTables(text: string): string {
  const withoutFences = text.replace(/```[\s\S]*?```/g, ' ')
  const lines = withoutFences.split('\n')
  const kept: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const isTableRow = /^\s*\|.*\|\s*$/.test(line)
    const isTableSeparator = /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
    if (
      isTableRow ||
      (isTableSeparator && kept.length > 0 && /^\s*\|.*\|\s*$/.test(kept.at(-1) ?? ''))
    ) {
      i++
      continue
    }
    kept.push(line)
    i++
  }
  return kept.join('\n')
}

/** Strips markdown structure (headings, bullets, bold, links, short inline code) to plain prose. */
function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, (_match, code: string) =>
      code.length <= INLINE_CODE_DROP_THRESHOLD ? code : ''
    )
}

const URL_PATTERN = /\bhttps?:\/\/\S+|\bwww\.\S+/gi
const POSIX_PATH_PATTERN = /(?:^|\s)(~?\/[\w-]+(?:\.[\w-]+)*(?:\/[\w-]+(?:\.[\w-]+)*)*\/?)/g
const WINDOWS_PATH_PATTERN = /(?:^|\s)([A-Za-z]:\\[\w-]+(?:\.[\w-]+)*(?:\\[\w-]+(?:\.[\w-]+)*)*)/g

/** Bare links and filesystem paths are unreadable aloud — the panel shows the real value. */
function replaceUrlsAndPaths(text: string): string {
  return text
    .replace(URL_PATTERN, 'ссылка в панели')
    .replace(POSIX_PATH_PATTERN, (match, path: string) => match.replace(path, 'путь в панели'))
    .replace(WINDOWS_PATH_PATTERN, (match, path: string) => match.replace(path, 'путь в панели'))
}

/** Collapses whitespace left behind by removed markup without touching sentence punctuation. */
function collapseWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join(' ')
    .replace(/ +/g, ' ')
    .trim()
}

export type NormalizeForSpeechOptions = {
  pronunciations?: CompanionPronunciationDictionary
}

/** Full pipeline from a raw brain reply to speakable Russian text. */
export function normalizeForSpeech(text: string, options: NormalizeForSpeechOptions = {}): string {
  const withoutStructure = dropCodeBlocksAndTables(text)
  const plain = stripMarkdownSyntax(withoutStructure)
  const withPlaceholders = replaceUrlsAndPaths(plain)
  const pronunciations = options.pronunciations ?? EMPTY_PRONUNCIATION_DICTIONARY
  // Before number expansion: splitting `v5`/`GPT-4` exposes digits `expandNumbers` can read.
  const cyrillicOnly = transliterateLatinForSpeech(withPlaceholders, pronunciations)
  const withNumbersExpanded = expandNumbers(cyrillicOnly)
  // Last: number agreement must see the plain noun (`минуты`, not `мин+уты`), and Russian
  // entries then also re-stress words the Latin and number passes produced.
  const withUserStress = applyRussianPronunciations(withNumbersExpanded, pronunciations)
  return collapseWhitespace(withUserStress)
}
