// Turns the user's wake phrases ("джарвис", "пятница") into the token-sequence keyword
// list sherpa-onnx's KeywordSpotter decodes against. The spotter is open-vocabulary: any
// phrase spelled in the model's BPE pieces works without retraining.
//
// Each phrase also gets inflected "decoy" keywords ("пятницу", "пятницы"): without them
// the decoder snaps "в эту пятницу" from the TV onto the closest keyword it has. With a
// decoy present the inflected form wins and is reported under a DECOY_LABEL_PREFIX label,
// which the caller ignores.

/** Label prefix sherpa reports for a decoy hit; never a real address. */
export const DECOY_LABEL_PREFIX = '~'

const WORD_START = '▁'

/** `tokens.txt` lines are "<piece> <id>"; returns the set of pieces. */
export function parseKeywordVocabulary(tokensFile: string): Set<string> {
  const vocabulary = new Set<string>()
  for (const line of tokensFile.split('\n')) {
    const piece = line.trim().split(/\s+/)[0]
    if (piece) {
      vocabulary.add(piece)
    }
  }
  return vocabulary
}

/**
 * Longest-match segmentation of one word into vocabulary pieces, the first carrying the
 * word-start marker. For the names themselves this lands on the pieces SentencePiece picks
 * (checked against the model's bpe.model for "джарвис" and "пятница"); a decoy may differ by
 * a piece, which only weakens that decoy. Avoids shipping a SentencePiece runtime.
 */
function tokenizeWord(word: string, vocabulary: ReadonlySet<string>): string[] | null {
  const pieces: string[] = []
  let rest = word
  let first = true
  while (rest.length > 0) {
    const prefix = first ? WORD_START : ''
    let length = rest.length
    while (length > 0 && !vocabulary.has(prefix + rest.slice(0, length))) {
      length--
    }
    if (length === 0) {
      if (first && vocabulary.has(WORD_START)) {
        pieces.push(WORD_START)
        first = false
        continue
      }
      return null
    }
    pieces.push(prefix + rest.slice(0, length))
    rest = rest.slice(length)
    first = false
  }
  return pieces
}

function tokenizePhrase(
  words: readonly string[],
  vocabulary: ReadonlySet<string>
): string[] | null {
  const pieces: string[] = []
  for (const word of words) {
    const wordPieces = tokenizeWord(word, vocabulary)
    if (!wordPieces) {
      return null
    }
    pieces.push(...wordPieces)
  }
  return pieces
}

const HUSHING_OR_VELAR = /[гкхжшчщ]$/
const HUSHING_OR_TS = /[жшчщц]$/

/** Common oblique-case forms of a Russian noun — what the TV says when it means the
 *  weekday, not the assistant. Nominative stays the keyword itself. */
export function inflectedDecoyForms(word: string): string[] {
  if (word.length < 4) {
    return []
  }
  const last = word.at(-1)
  const stem = word.slice(0, -1)
  if (last === 'а') {
    return [
      `${stem}у`,
      `${stem}${HUSHING_OR_VELAR.test(stem) ? 'и' : 'ы'}`,
      `${stem}е`,
      `${stem}${HUSHING_OR_TS.test(stem) ? 'ей' : 'ой'}`
    ]
  }
  if (last === 'я') {
    return [`${stem}ю`, `${stem}и`, `${stem}е`, `${stem}ей`]
  }
  if (/[бвгджзклмнпрстфхцчшщ]/.test(last ?? '')) {
    return [`${word}а`, `${word}у`, `${word}ом`, `${word}е`]
  }
  return []
}

export type WakeKeywordList = {
  /** Newline-separated "<pieces> @<label>" lines — sherpa's `keywordsBuf` format. */
  keywords: string
  /** Phrases the vocabulary could not spell (e.g. Latin letters for a Cyrillic model). */
  skipped: string[]
}

export function buildWakeKeywordList(
  phrases: readonly string[],
  vocabulary: ReadonlySet<string>
): WakeKeywordList {
  const lines = new Set<string>()
  const skipped: string[] = []
  for (const phrase of phrases) {
    const words = Array.from(phrase.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu), (m) => m[0])
    const pieces = words.length > 0 ? tokenizePhrase(words, vocabulary) : null
    if (!pieces) {
      skipped.push(phrase)
      continue
    }
    lines.add(`${pieces.join(' ')} @${words.join('_')}`)
    const lastWord = words.at(-1) ?? ''
    for (const form of inflectedDecoyForms(lastWord)) {
      const decoyWords = [...words.slice(0, -1), form]
      const decoyPieces = tokenizePhrase(decoyWords, vocabulary)
      if (decoyPieces) {
        lines.add(`${decoyPieces.join(' ')} @${DECOY_LABEL_PREFIX}${decoyWords.join('_')}`)
      }
    }
  }
  return { keywords: [...lines].join('\n'), skipped }
}
