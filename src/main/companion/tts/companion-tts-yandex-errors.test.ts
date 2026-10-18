import { describe, expect, it } from 'vitest'
import {
  CompanionTtsYandexError,
  classifyYandexHttpStatus,
  describeYandexErrorRu
} from './companion-tts-yandex-errors'

describe('classifyYandexHttpStatus', () => {
  it('maps 401 and 403 to auth', () => {
    expect(classifyYandexHttpStatus(401)).toBe('auth')
    expect(classifyYandexHttpStatus(403)).toBe('auth')
  })

  it('maps 429 to quota', () => {
    expect(classifyYandexHttpStatus(429)).toBe('quota')
  })

  it('maps 5xx to server', () => {
    expect(classifyYandexHttpStatus(500)).toBe('server')
    expect(classifyYandexHttpStatus(503)).toBe('server')
  })

  it('maps anything else to unknown', () => {
    expect(classifyYandexHttpStatus(400)).toBe('unknown')
    expect(classifyYandexHttpStatus(404)).toBe('unknown')
  })
})

describe('describeYandexErrorRu', () => {
  it('describes each classified error code in Russian', () => {
    expect(describeYandexErrorRu(new CompanionTtsYandexError('auth', 'x'))).toMatch(/ключ/i)
    expect(describeYandexErrorRu(new CompanionTtsYandexError('quota', 'x'))).toMatch(/лимит/i)
    expect(describeYandexErrorRu(new CompanionTtsYandexError('server', 'x'))).toMatch(/недоступен/i)
  })

  it('describes a fetch network failure (bare TypeError) as a network error', () => {
    expect(describeYandexErrorRu(new TypeError('fetch failed'))).toMatch(/интернет/i)
  })

  it('describes an AbortError as a network error', () => {
    expect(describeYandexErrorRu(new DOMException('aborted', 'AbortError'))).toMatch(/интернет/i)
  })

  it('falls back to a generic Russian message for an unrecognized error', () => {
    expect(describeYandexErrorRu(new Error('something else'))).toMatch(/не получилось/i)
  })
})
