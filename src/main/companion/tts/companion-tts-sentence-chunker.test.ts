import { describe, expect, it } from 'vitest'
import {
  SENTENCE_MAX_CHARS,
  SentenceStreamChunker,
  splitIntoSentences
} from './companion-tts-sentence-chunker'

describe('splitIntoSentences', () => {
  it('splits on sentence terminators and trims whitespace', () => {
    const { sentences, remainder } = splitIntoSentences('Привет. Как дела? Отлично!')
    expect(sentences).toEqual(['Привет.', 'Как дела?', 'Отлично!'])
    expect(remainder).toBe('')
  })

  it('keeps an unterminated tail as remainder', () => {
    const { sentences, remainder } = splitIntoSentences('Первое. Начало второго')
    expect(sentences).toEqual(['Первое.'])
    expect(remainder).toBe('Начало второго')
  })

  it('handles quotes and ellipses after terminators', () => {
    const { sentences } = splitIntoSentences('Он сказал: "Привет." Потом ушёл… Правда.')
    expect(sentences).toEqual(['Он сказал: "Привет."', 'Потом ушёл…', 'Правда.'])
  })

  it('cuts a sentence longer than the cap at a comma or space, never mid-word', () => {
    const longClause = Array.from({ length: 40 }, (_, i) => `слово${i}`).join(', ')
    const { sentences } = splitIntoSentences(`${longClause}.`)
    expect(sentences.length).toBeGreaterThan(1)
    for (const sentence of sentences) {
      expect(sentence.length).toBeLessThanOrEqual(SENTENCE_MAX_CHARS + 1)
      expect(sentence.endsWith(' ')).toBe(false)
    }
    expect(sentences.join(' ').replace(/,\s*/g, ', ')).toContain('слово0')
    expect(sentences.at(-1)).toMatch(/\.$/)
  })
})

describe('SentenceStreamChunker', () => {
  it('emits a sentence only once its delta arrives, mid-word splits included', () => {
    const chunker = new SentenceStreamChunker()
    expect(chunker.push('При')).toEqual([])
    expect(chunker.push('вет')).toEqual([])
    expect(chunker.push('. Как')).toEqual(['Привет.'])
    expect(chunker.push(' дела?')).toEqual(['Как дела?'])
  })

  it('flushes a trailing remainder with no terminator at turn end', () => {
    const chunker = new SentenceStreamChunker()
    chunker.push('Без точки в конце')
    expect(chunker.flush()).toEqual(['Без точки в конце'])
    expect(chunker.flush()).toEqual([])
  })

  it('reset drops buffered partial text', () => {
    const chunker = new SentenceStreamChunker()
    chunker.push('висящий фрагмент')
    chunker.reset()
    expect(chunker.flush()).toEqual([])
  })

  it('earlyClauseSplit emits the first clause once the buffer passes the threshold', () => {
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const clause = 'а'.repeat(30)
    expect(chunker.push(`${clause}, `)).toEqual([`${clause},`])
  })

  it('earlyClauseSplit does nothing before MIN_EARLY_CLAUSE_CHARS is reached', () => {
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const shortClause = 'а'.repeat(10)
    expect(chunker.push(`${shortClause}, ещё`)).toEqual([])
  })

  it('earlyClauseSplit recognizes colon, semicolon, and a space-delimited dash', () => {
    const clause = 'а'.repeat(30)
    expect(new SentenceStreamChunker({ earlyClauseSplit: true }).push(`${clause}: ещё`)).toEqual([
      `${clause}:`
    ])
    expect(new SentenceStreamChunker({ earlyClauseSplit: true }).push(`${clause}; ещё`)).toEqual([
      `${clause};`
    ])
    expect(new SentenceStreamChunker({ earlyClauseSplit: true }).push(`${clause} — ещё`)).toEqual([
      `${clause} —`
    ])
  })

  it('earlyClauseSplit only applies to the first chunk of the utterance, not later ones', () => {
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const clause = 'а'.repeat(30)
    expect(chunker.push(`${clause}, `)).toEqual([`${clause},`])
    // Another clause boundary arrives, but a chunk was already emitted for this utterance:
    // it must wait for the sentence terminator like the non-early path does.
    expect(chunker.push('ещё, слова')).toEqual([])
    expect(chunker.push(' тут.')).toEqual(['ещё, слова тут.'])
  })

  it("earlyClauseSplit is off by default, matching today's Yandex-path behavior", () => {
    const chunker = new SentenceStreamChunker()
    const clause = 'а'.repeat(30)
    expect(chunker.push(`${clause}, ещё слова.`)).toEqual([`${clause}, ещё слова.`])
  })

  it('earlyClauseSplit resets with the chunker', () => {
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const clause = 'а'.repeat(30)
    expect(chunker.push(`${clause}, `)).toEqual([`${clause},`])
    chunker.reset()
    expect(chunker.push(`${clause}, ещё`)).toEqual([`${clause},`])
  })
})
