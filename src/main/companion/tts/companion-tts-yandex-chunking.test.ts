import { describe, expect, it } from 'vitest'
import { packSentencesForYandex } from './companion-tts-yandex-chunking'
import { yandexV3UnitsForChars } from './companion-tts-yandex-pricing'

describe('packSentencesForYandex', () => {
  it('packs several short sentences into a single request chunk under the limit', () => {
    const result = packSentencesForYandex(['Привет.', 'Как дела?', 'Всё хорошо.'], 250)

    expect(result.requestChunks).toEqual(['Привет. Как дела? Всё хорошо.'])
    expect(result.truncated).toBe(false)
  })

  it('never produces a request chunk over 250 characters', () => {
    const sentenceA = 'A'.repeat(200)
    const sentenceB = 'B'.repeat(200)
    const result = packSentencesForYandex([sentenceA, sentenceB], 1000)

    expect(result.requestChunks).toHaveLength(2)
    for (const chunk of result.requestChunks) {
      expect(chunk.length).toBeLessThanOrEqual(250)
    }
  })

  it('splits only once the next sentence would overflow the current 250-char unit', () => {
    const sentenceA = 'A'.repeat(100)
    const sentenceB = 'B'.repeat(100)
    const sentenceC = 'C'.repeat(40)
    // 100 + 1 + 100 = 201 (fits), + 1 + 40 = 242 (fits) -> everything in one unit.
    const result = packSentencesForYandex([sentenceA, sentenceB, sentenceC], 1000)

    expect(result.requestChunks).toHaveLength(1)
  })

  it('stops accepting sentences once maxSpokenChars is exceeded, keeping the rest unspoken', () => {
    const sentences = ['Первое предложение.', 'Второе предложение.', 'Третье предложение.']
    const result = packSentencesForYandex(sentences, 25)

    expect(result.requestChunks).toEqual(['Первое предложение.'])
    expect(result.spokenChars).toBe('Первое предложение.'.length)
    expect(result.truncated).toBe(true)
  })

  it('always speaks the first sentence even when it alone exceeds the cap', () => {
    const longSentence = 'Д'.repeat(300)
    const result = packSentencesForYandex([longSentence, 'Второе.'], 100)

    expect(result.requestChunks).toEqual([longSentence])
    expect(result.truncated).toBe(true)
  })

  it('returns no chunks and is not truncated for an empty sentence list', () => {
    const result = packSentencesForYandex([], 250)

    expect(result.requestChunks).toEqual([])
    expect(result.truncated).toBe(false)
    expect(result.spokenChars).toBe(0)
  })

  it('a reply capped at 250 chars costs exactly one v3 request unit', () => {
    const sentences = [
      'Первое предложение в ответе компаньона.',
      'Второе предложение добавляет немного деталей.',
      'Третье предложение почти достигает предела по символам ответа целиком.'
    ]
    const result = packSentencesForYandex(sentences, 250)

    expect(result.requestChunks.length).toBe(1)
    expect(yandexV3UnitsForChars(result.requestChunks[0].length)).toBe(1)
  })
})
