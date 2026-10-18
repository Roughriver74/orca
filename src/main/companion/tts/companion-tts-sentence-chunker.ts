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
function splitLongSentence(sentence: string): string[] {
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

/**
 * Stateful accumulator for brain text deltas: feed arrives in arbitrary-sized chunks,
 * `push` returns every sentence that became complete, `flush` forces out the remainder
 * once the turn ends (a reply with no trailing punctuation still has to be spoken).
 */
export class SentenceStreamChunker {
  private buffer = ''

  push(delta: string): string[] {
    this.buffer += delta
    const { sentences, remainder } = splitIntoSentences(this.buffer)
    this.buffer = remainder
    return sentences
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
  }
}
