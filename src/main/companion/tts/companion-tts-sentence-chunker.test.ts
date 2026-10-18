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
})
