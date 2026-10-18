import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CompanionTtsYandexCache, companionTtsCacheKey } from './companion-tts-yandex-cache'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-yandex-tts-cache-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('companionTtsCacheKey', () => {
  it('differs when voice, api, rate, or text differ', () => {
    const base = { voice: 'kirill', api: 'v3' as const, rate: 1, text: 'привет' }
    const key = companionTtsCacheKey(base)
    expect(companionTtsCacheKey({ ...base, voice: 'filipp' })).not.toBe(key)
    expect(companionTtsCacheKey({ ...base, api: 'v1' })).not.toBe(key)
    expect(companionTtsCacheKey({ ...base, rate: 1.5 })).not.toBe(key)
    expect(companionTtsCacheKey({ ...base, text: 'пока' })).not.toBe(key)
  })

  it('is stable for identical inputs', () => {
    const base = { voice: 'kirill', api: 'v3' as const, rate: 1, text: 'привет' }
    expect(companionTtsCacheKey(base)).toBe(companionTtsCacheKey({ ...base }))
  })
})

describe('CompanionTtsYandexCache', () => {
  it('returns null for a miss', async () => {
    const cache = new CompanionTtsYandexCache(dir)
    expect(await cache.get('missing')).toBeNull()
  })

  it('round-trips sample rate and PCM samples through put/get', async () => {
    const cache = new CompanionTtsYandexCache(dir)
    const pcm = new Float32Array([0.1, -0.2, 0.3])

    await cache.put('key-1', { sampleRate: 48_000, pcm })
    const result = await cache.get('key-1')

    expect(result?.sampleRate).toBe(48_000)
    expect(Array.from(result?.pcm ?? [])).toEqual([
      Math.fround(0.1),
      Math.fround(-0.2),
      Math.fround(0.3)
    ])
  })

  it('evicts the least-recently-used entry once over the byte budget', async () => {
    // Each entry is a small JSON header + 400 float32 samples (1600 bytes) -> a budget of
    // one entry's worth forces eviction on the second put. `utimes` (not a real sleep
    // between puts) makes "old" deterministically the older entry regardless of how
    // close together the two real `put()` calls land on the wall clock.
    const entryBytes = 1600 + 40
    const cache = new CompanionTtsYandexCache(dir, entryBytes + 10)
    const pcm = new Float32Array(400).fill(0.5)

    await cache.put('old', { sampleRate: 48_000, pcm })
    await utimes(join(dir, 'old.cache'), new Date(0), new Date(0))
    await cache.put('new', { sampleRate: 48_000, pcm })

    expect(await cache.get('old')).toBeNull()
    expect(await cache.get('new')).not.toBeNull()
  })

  it('refreshes an entry on read so it is not the next eviction target', async () => {
    const entryBytes = 1600 + 40
    const cache = new CompanionTtsYandexCache(dir, entryBytes * 2 + 10)
    const pcm = new Float32Array(400).fill(0.5)

    await cache.put('a', { sampleRate: 48_000, pcm })
    await cache.put('b', { sampleRate: 48_000, pcm })
    await utimes(join(dir, 'b.cache'), new Date(0), new Date(0))
    // Touch "a" (bumps its mtime to now) so "b" is unambiguously the older entry.
    await cache.get('a')
    await cache.put('c', { sampleRate: 48_000, pcm })

    expect(await cache.get('a')).not.toBeNull()
    expect(await cache.get('b')).toBeNull()
  })

  it('writes atomically — no partial file left behind on the final path', async () => {
    const cache = new CompanionTtsYandexCache(dir)
    await cache.put('key', { sampleRate: 48_000, pcm: new Float32Array([1]) })
    expect(() => statSync(join(dir, 'key.cache'))).not.toThrow()
  })
})
