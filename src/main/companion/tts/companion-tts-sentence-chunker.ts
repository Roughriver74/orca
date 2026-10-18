// Splits normalized speech text into sentences short enough for one Silero call (the
// lab venv warns past 140 characters; we cap well under that so late words in a long
// sentence are not silently dropped) and in a form the brain's streaming deltas can
// feed incrementally: a sentence is only emitted once a terminator is seen, so the
// caller can start synthesizing sentence N while the brain is still writing N+1.

export const SENTENCE_MAX_CHARS = 250

const SENTENCE_TERMINATORS = /[.!?…]+[)"'»]?(?=\s|$)/g

/** Splits already-normalized text into complete sentences, trailing partial text last. */
export function splitIntoSentences(text: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = []
  let lastEnd = 0
  SENTENCE_TERMINATORS.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SENTENCE_TERMINATORS.exec(text)) !== null) {
    const end = match.index + match[0].length
    const sentence = text.slice(lastEnd, end).trim()
    if (sentence.length > 0) {
      sentences.push(...splitLongSentence(sentence))
    }
    lastEnd = end
  }
  return { sentences, remainder: text.slice(lastEnd).trim() }
}

/** A sentence longer than the cap is cut at the nearest comma/space before it, never mid-word. */
export function splitLongSentence(sentence: string): string[] {
  if (sentence.length <= SENTENCE_MAX_CHARS) {
    return [sentence]
  }
  const parts: string[] = []
  let rest = sentence
  while (rest.length > SENTENCE_MAX_CHARS) {
    const window = rest.slice(0, SENTENCE_MAX_CHARS + 1)
    const commaBreak = window.lastIndexOf(', ')
    const spaceBreak = window.lastIndexOf(' ')
    const breakAt = commaBreak > SENTENCE_MAX_CHARS / 2 ? commaBreak + 1 : spaceBreak
    const cut = breakAt > 0 ? breakAt : SENTENCE_MAX_CHARS
    parts.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  if (rest.length > 0) {
    parts.push(rest)
  }
  return parts
}

const MIN_EARLY_CLAUSE_CHARS = 25

// Comma/colon/semicolon anywhere, or a dash only when it sits between spaces (so a
// hyphenated word like "по-английски" is never mistaken for a clause break).
const CLAUSE_BOUNDARY = /[,;:]|(?<=\s)[-—–](?=\s)/g

/**
 * Stateful accumulator for brain text deltas: feed arrives in arbitrary-sized chunks,
 * `push` returns every sentence that became complete, `flush` forces out the remainder
 * once the turn ends (a reply with no trailing punctuation still has to be spoken).
 *
 * `earlyClauseSplit` (Silero streaming path only, see companion-tts-service.ts) trims the
 * audible delay before the first sentence: while nothing has been emitted yet for the
 * current utterance, a long first sentence often has a comma/colon/dash well before its
 * final terminator, and starting Silero on that clause lets audio begin while the brain
 * is still writing the rest of the sentence. The Yandex path leaves this off — Yandex v3
 * bills per request (up to 250 chars each), so splitting a sentence early there would
 * turn one billed request into two for no latency benefit (Yandex synthesizes a whole
 * sentence fast enough that the cold-start problem this solves does not apply).
 */
export class SentenceStreamChunker {
  private buffer = ''
  private hasEmitted = false
  private readonly earlyClauseSplit: boolean

  constructor(options: { earlyClauseSplit?: boolean } = {}) {
    this.earlyClauseSplit = options.earlyClauseSplit ?? false
  }

  push(delta: string): string[] {
    this.buffer += delta
    const { sentences, remainder } = splitIntoSentences(this.buffer)
    this.buffer = remainder
    if (sentences.length > 0) {
      this.hasEmitted = true
      return sentences
    }
    if (this.earlyClauseSplit && !this.hasEmitted) {
      const earlyClause = this.takeEarlyClause()
      if (earlyClause !== null) {
        this.hasEmitted = true
        return [earlyClause]
      }
    }
    return []
  }

  /** Cuts the buffer at the first clause boundary occurring at or after
   *  `MIN_EARLY_CLAUSE_CHARS`, or returns null if the buffer is too short or has none yet. */
  private takeEarlyClause(): string | null {
    if (this.buffer.length < MIN_EARLY_CLAUSE_CHARS) {
      return null
    }
    CLAUSE_BOUNDARY.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = CLAUSE_BOUNDARY.exec(this.buffer)) !== null) {
      if (match.index < MIN_EARLY_CLAUSE_CHARS) {
        continue
      }
      const cut = match.index + match[0].length
      const clause = this.buffer.slice(0, cut).trim()
      this.buffer = this.buffer.slice(cut)
      return clause.length > 0 ? clause : null
    }
    return null
  }

  flush(): string[] {
    const remainder = this.buffer.trim()
    this.buffer = ''
    if (remainder.length === 0) {
      return []
    }
    return splitLongSentence(remainder)
  }

  reset(): void {
    this.buffer = ''
    this.hasEmitted = false
  }
}

/**
 * Streamed replies are normalized sentence by sentence, so a fenced code block can span
 * several of them and `dropCodeBlocksAndTables` never sees both fences. This tracks fence
 * parity across sentences and keeps only the prose outside them.
 */
export class SpeechCodeFenceFilter {
  private insideFence = false

  filter(sentence: string): string {
    const segments = sentence.split('```')
    const kept = segments.filter((_segment, index) => (index % 2 === 0) !== this.insideFence)
    if (segments.length % 2 === 0) {
      this.insideFence = !this.insideFence
    }
    return kept.join(' ')
  }
}
