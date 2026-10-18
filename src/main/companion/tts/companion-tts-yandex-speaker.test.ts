import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./companion-tts-yandex-key-store', () => ({
  hasYandexSpeechKitApiKey: vi.fn(() => true),
  readYandexSpeechKitApiKey: vi.fn(() => 'test-key')
}))

const { CompanionTtsYandexSpeaker } = await import('./companion-tts-yandex-speaker')
const { getCompanionTtsUsageSnapshot } = await import('./companion-tts-usage')
const keyStore = await import('./companion-tts-yandex-key-store')

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-yandex-speaker-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.mocked(keyStore.hasYandexSpeechKitApiKey).mockReturnValue(true)
})

function fakeProvider(pcmLength = 4) {
  return {
    synthesize: vi.fn(async () => ({ sampleRate: 48_000, pcm: new Float32Array(pcmLength) })),
    cancel: vi.fn()
  }
}

describe('CompanionTtsYandexSpeaker', () => {
  it('isAvailable() reflects whether a key is configured', () => {
    const speaker = new CompanionTtsYandexSpeaker(dir)
    expect(speaker.isAvailable()).toBe(true)

    vi.mocked(keyStore.hasYandexSpeechKitApiKey).mockReturnValue(false)
    expect(speaker.isAvailable()).toBe(false)
  })

  it('synthesizes on a cache miss and records usage cost', async () => {
    const provider = fakeProvider()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the speaker only calls synthesize/cancel on its provider dependency.
    const speaker = new CompanionTtsYandexSpeaker(dir, { provider: provider as never })

    const result = await speaker.synthesize('req-1', 'привет', 'kirill', 1)

    expect(provider.synthesize).toHaveBeenCalledOnce()
    expect(result.pcm).toHaveLength(4)
    const snapshot = getCompanionTtsUsageSnapshot(dir, 300)
    expect(snapshot.today.requests).toBe(1)
    expect(snapshot.today.requestUnits).toBe(1)
    expect(snapshot.today.costRub).toBeGreaterThan(0)
  })

  it('serves a repeated request from cache without calling the provider again', async () => {
    const provider = fakeProvider()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
    const speaker = new CompanionTtsYandexSpeaker(dir, { provider: provider as never })

    await speaker.synthesize('req-1', 'привет', 'kirill', 1)
    await speaker.synthesize('req-2', 'привет', 'kirill', 1)

    expect(provider.synthesize).toHaveBeenCalledOnce()
    const snapshot = getCompanionTtsUsageSnapshot(dir, 300)
    expect(snapshot.today.requests).toBe(2)
    expect(snapshot.today.cacheHitsSaved).toBe(1)
    expect(snapshot.today.cacheHitSavingsRub).toBeGreaterThan(0)
  })

  it('does not cache across different voices for the same text', async () => {
    const provider = fakeProvider()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
    const speaker = new CompanionTtsYandexSpeaker(dir, { provider: provider as never })

    await speaker.synthesize('req-1', 'привет', 'kirill', 1)
    await speaker.synthesize('req-2', 'привет', 'filipp', 1)

    expect(provider.synthesize).toHaveBeenCalledTimes(2)
  })

  it('delegates cancel() to the underlying provider', () => {
    const provider = fakeProvider()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
    const speaker = new CompanionTtsYandexSpeaker(dir, { provider: provider as never })

    speaker.cancel('req-1')

    expect(provider.cancel).toHaveBeenCalledWith('req-1')
  })
})
