import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRecord } from '../../../shared/agent-status-child-work-value-guards'
import { CompanionTtsYandexProvider } from './companion-tts-yandex-provider'
import { CompanionTtsCancelledError } from './companion-tts-sidecar-process'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function pcmBuffer(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => buffer.writeInt16LE(sample, i * 2))
  return buffer
}

function v3NdjsonStream(base64Chunks: string[]): ReadableStream<Uint8Array> {
  const lines = base64Chunks.map(
    (data) => `${JSON.stringify({ result: { audioChunk: { data } } })}\n`
  )
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(new TextEncoder().encode(line))
      }
      controller.close()
    }
  })
}

describe('CompanionTtsYandexProvider', () => {
  it('synthesizes via v1 (form body, raw PCM response) for a v1-capable voice', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toContain('tts:synthesize')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Api-Key test-key')
      return new Response(new Uint8Array(pcmBuffer([1000, -1000])), { status: 200 })
    })
    globalThis.fetch = fetchMock
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    const result = await provider.synthesize('req-1', 'привет', 'filipp', 1)

    expect(result.sampleRate).toBe(48_000)
    expect(result.pcm).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('sends the rate as the v1 form-encoded "speed" field', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const body = init?.body
      if (!(body instanceof URLSearchParams)) {
        throw new Error('expected a URLSearchParams body')
      }
      expect(body.get('speed')).toBe('1.3')
      return new Response(new Uint8Array(pcmBuffer([0])), { status: 200 })
    })
    globalThis.fetch = fetchMock
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    await provider.synthesize('req-1b', 'привет', 'filipp', 1.3)

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('synthesizes via v3 (JSON body, NDJSON response) for a v3-only voice', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      expect(String(url)).toContain('utteranceSynthesis')
      const pcm = pcmBuffer([500, -500])
      const base64 = pcm.toString('base64')
      return new Response(v3NdjsonStream([base64]), { status: 200 })
    })
    globalThis.fetch = fetchMock
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    const result = await provider.synthesize('req-2', 'привет', 'kirill', 1)

    expect(result.sampleRate).toBe(48_000)
    expect(result.pcm).toHaveLength(2)
  })

  it('sends the rate as a v3 "speed" hint alongside the voice hint', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      const parsed: unknown = JSON.parse(String(init?.body))
      if (!isRecord(parsed) || !Array.isArray(parsed.hints)) {
        throw new Error('expected a hints array in the v3 request body')
      }
      expect(parsed.hints).toContainEqual({ speed: 1.3 })
      return new Response(v3NdjsonStream([]), { status: 200 })
    })
    globalThis.fetch = fetchMock
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    await provider.synthesize('req-2b', 'привет', 'kirill', 1.3)

    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reassembles PCM split across multiple NDJSON audio chunks in order', async () => {
    const first = pcmBuffer([1, 2]).toString('base64')
    const second = pcmBuffer([3, 4]).toString('base64')
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response(v3NdjsonStream([first, second]), { status: 200 })
    )
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    const result = await provider.synthesize('req-3', 'текст', 'kirill', 1)

    expect(Array.from(result.pcm)).toHaveLength(4)
  })

  it('maps a 401 response to a CompanionTtsYandexError with code "auth"', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => new Response('bad key', { status: 401 }))
    const provider = new CompanionTtsYandexProvider(() => 'bad-key')

    await expect(provider.synthesize('req-4', 'привет', 'filipp', 1)).rejects.toMatchObject({
      code: 'auth'
    })
  })

  it('maps a 429 response to a CompanionTtsYandexError with code "quota"', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(
      async () => new Response('rate limited', { status: 429 })
    )
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    await expect(provider.synthesize('req-5', 'привет', 'filipp', 1)).rejects.toMatchObject({
      code: 'quota'
    })
  })

  it('propagates a network failure (fetch throws TypeError) unmodified', async () => {
    globalThis.fetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed')
    })
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    await expect(provider.synthesize('req-6', 'привет', 'filipp', 1)).rejects.toBeInstanceOf(
      TypeError
    )
  })

  it('cancel() aborts the in-flight request, rejecting with CompanionTtsCancelledError', async () => {
    globalThis.fetch = vi.fn<typeof fetch>((_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>()
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'))
      })
      return promise
    })
    const provider = new CompanionTtsYandexProvider(() => 'test-key')

    const pending = provider.synthesize('req-7', 'привет', 'filipp', 1)
    provider.cancel('req-7')

    await expect(pending).rejects.toBeInstanceOf(CompanionTtsCancelledError)
  })

  it('cancel() on an unknown request id is a no-op', () => {
    const provider = new CompanionTtsYandexProvider(() => 'test-key')
    expect(() => provider.cancel('never-started')).not.toThrow()
  })
})
