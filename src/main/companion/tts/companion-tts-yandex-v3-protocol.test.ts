import { describe, expect, it } from 'vitest'
import { createYandexV3NdjsonParser } from './companion-tts-yandex-v3-protocol'

function line(base64: string): string {
  return `${JSON.stringify({ result: { audioChunk: { data: base64 } } })}\n`
}

describe('createYandexV3NdjsonParser', () => {
  it('parses one complete line fed in a single chunk', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))

    parser.feed(line('aGVsbG8='))

    expect(chunks).toEqual(['aGVsbG8='])
  })

  it('parses multiple lines fed in one chunk', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))

    parser.feed(line('AAA=') + line('BBB='))

    expect(chunks).toEqual(['AAA=', 'BBB='])
  })

  it('reassembles a line split across two feed() calls', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))
    const whole = line('c3BsaXQtbGluZQ==')
    const splitAt = Math.floor(whole.length / 2)

    parser.feed(whole.slice(0, splitAt))
    expect(chunks).toEqual([])
    parser.feed(whole.slice(splitAt))

    expect(chunks).toEqual(['c3BsaXQtbGluZQ=='])
  })

  it('reassembles a line split across three feed() calls, including mid-JSON splits', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))
    const whole = line('dGhyZWUtd2F5')

    parser.feed(whole.slice(0, 5))
    parser.feed(whole.slice(5, 15))
    parser.feed(whole.slice(15))

    expect(chunks).toEqual(['dGhyZWUtd2F5'])
  })

  it('flushes a final line that has no trailing newline', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))
    const whole = line('bm8tdHJhaWxpbmctbmV3bGluZQ==')

    parser.feed(whole.trimEnd())
    expect(chunks).toEqual([])
    parser.flush()

    expect(chunks).toEqual(['bm8tdHJhaWxpbmctbmV3bGluZQ=='])
  })

  it('ignores blank lines and lines without an audio chunk', () => {
    const chunks: string[] = []
    const parser = createYandexV3NdjsonParser((base64) => chunks.push(base64))

    parser.feed('\n')
    parser.feed(`${JSON.stringify({ result: {} })}\n`)
    parser.feed('not json at all\n')
    parser.feed(line('ZGF0YQ=='))

    expect(chunks).toEqual(['ZGF0YQ=='])
  })
})
