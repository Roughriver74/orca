import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../resources/companion/tts-sidecar.py?asset&asarUnpack', () => ({
  default: '/fake/tts-sidecar.py'
}))

const sendAudioChunk = vi.fn()
const stopAudio = vi.fn()
const sendTtsError = vi.fn()
vi.mock('../companion-audio-output', () => ({
  sendAudioChunk: (...args: unknown[]) => sendAudioChunk(...args),
  stopAudio: (...args: unknown[]) => stopAudio(...args),
  sendTtsError: (...args: unknown[]) => sendTtsError(...args)
}))

const loadPronunciations = vi.fn(async (_path: string) => new Map([['worktree', 'вёрктри']]))
vi.mock('./companion-tts-pronunciation-dictionary', () => ({
  loadCompanionPronunciationDictionary: (path: string) => loadPronunciations(path)
}))

vi.mock('./companion-tts-provisioning', () => ({
  getCompanionTtsPaths: (userDataDir: string) => ({
    rootDir: `${userDataDir}/companion-tts`,
    uvBinaryPath: `${userDataDir}/companion-tts/uv/uv`,
    venvDir: `${userDataDir}/companion-tts/venv`,
    venvPythonPath: `${userDataDir}/companion-tts/venv/bin/python`,
    v5ModelPath: `${userDataDir}/companion-tts/models/v5_4_ru.pt`,
    v3ModelPath: `${userDataDir}/companion-tts/models/v3_1_ru.pt`
  }),
  readProvisionedModelPaths: vi.fn().mockResolvedValue({
    v5ModelPath: '/fake/v5.pt',
    v3ModelPath: '/fake/v3.pt'
  })
}))

const { CompanionTtsCancelledError } = await import('./companion-tts-sidecar-process')
const { CompanionTtsService } = await import('./companion-tts-service')
const provisioning = await import('./companion-tts-provisioning')

type FakeSidecar = {
  synthesize: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
  isHealthy: ReturnType<typeof vi.fn>
  warmUp: ReturnType<typeof vi.fn>
}

type FakePcmChunk = { sampleRate: number; pcm: Float32Array; final: boolean }

function pcmChunk(samples: number[], sampleRate = 48000): FakePcmChunk {
  return { sampleRate, pcm: new Float32Array(samples), final: true }
}

function fakeSidecar(behavior: (id: string, text: string) => Promise<FakePcmChunk>): FakeSidecar {
  return {
    synthesize: vi.fn(
      async (id: string, text: string, _speaker: string, _rate: number, onChunk) => {
        const chunk = await behavior(id, text)
        onChunk({
          requestId: id,
          seq: 0,
          sampleRate: chunk.sampleRate,
          final: chunk.final,
          pcm: chunk.pcm
        })
      }
    ),
    cancel: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    isHealthy: vi.fn().mockReturnValue(true),
    warmUp: vi.fn().mockResolvedValue(undefined)
  }
}

/** Drains pending microtasks deterministically (fake timers), no real wall-clock wait. */
async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('CompanionTtsService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sendAudioChunk.mockClear()
    stopAudio.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('speak() splits into sentences and sends each chunk with final only on the last', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    await service.speak('Привет. Как дела? Отлично!', {
      utteranceId: 'u1',
      voice: 'eugene',
      rate: 1
    })

    expect(sidecar.synthesize).toHaveBeenCalledTimes(3)
    expect(sendAudioChunk).toHaveBeenCalledTimes(3)
    const calls = sendAudioChunk.mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.utteranceId)).toEqual(['u1', 'u1', 'u1'])
    expect(calls.map((c) => c.seq)).toEqual([0, 1, 2])
    expect(calls.map((c) => c.final)).toEqual([false, false, true])
  })

  it('speakStream() synthesizes sentences incrementally as deltas complete them', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    const stream = service.speakStream({ utteranceId: 'u2', voice: 'aidar', rate: 1 })
    stream.pushDelta('При')
    stream.pushDelta('вет. Как')
    await flushAsync()
    expect(sidecar.synthesize).toHaveBeenCalledTimes(1)

    stream.pushDelta(' дела?')
    stream.finish()
    await flushAsync()

    const calls = sendAudioChunk.mock.calls.map((c) => c[0])
    expect(calls).toHaveLength(2)
    expect(calls[1].final).toBe(true)
  })

  it('stop() cancels the outstanding request and tells the playback contract to stop', async () => {
    // Why reject rather than resolve: `cancel()` on the real sidecar manager rejects the
    // pending promise with CompanionTtsCancelledError (see companion-tts-sidecar-process.ts);
    // this fake mirrors that contract instead of racing a resolve against a cancel.
    const synthResolvers = Promise.withResolvers<never>()
    synthResolvers.promise.catch(() => {})
    const sidecar: FakeSidecar = {
      synthesize: vi.fn(() => synthResolvers.promise),
      cancel: vi.fn(),
      shutdown: vi.fn().mockResolvedValue(undefined),
      isHealthy: vi.fn().mockReturnValue(true),
      warmUp: vi.fn().mockResolvedValue(undefined)
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    const speaking = service.speak('Одно.', { utteranceId: 'u3', voice: 'eugene', rate: 1 })
    await flushAsync()
    service.stop('u3')
    expect(stopAudio).toHaveBeenCalledWith('u3')
    expect(sidecar.cancel).toHaveBeenCalled()
    synthResolvers.reject(new CompanionTtsCancelledError('u3:req'))
    await speaking
  })

  it('ensureSidecar rejects speak() before TTS has been provisioned', async () => {
    vi.mocked(provisioning.readProvisionedModelPaths).mockResolvedValueOnce({
      v5ModelPath: null,
      v3ModelPath: null
    })
    const sidecar = fakeSidecar(async () => pcmChunk([1]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)
    await expect(
      service.speak('Привет.', { utteranceId: 'u4', voice: 'eugene', rate: 1 })
    ).rejects.toThrow(/not been provisioned/)
  })

  it('speakStream() normalizes each sentence, transliterating Latin words with the user dictionary', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    const stream = service.speakStream({
      utteranceId: 'u5',
      voice: 'aidar',
      rate: 1,
      pronunciationsPath: '/home/tts-pronunciations.txt'
    })
    stream.pushDelta('Сделал **commit** в worktree. Готово.')
    stream.finish()
    await flushAsync()

    expect(loadPronunciations).toHaveBeenCalledWith('/home/tts-pronunciations.txt')
    expect(sidecar.synthesize.mock.calls.map((call) => call[1])).toEqual([
      'Сделал коммит в вёрктри.',
      'Готово.'
    ])
  })

  it('speakStream() skips a fenced code block that spans several sentences', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    const stream = service.speakStream({ utteranceId: 'u6', voice: 'aidar', rate: 1 })
    stream.pushDelta('Вот пример. ```ts\nconst a = 1. ')
    stream.pushDelta('const b = 2.\n``` Всё.')
    stream.finish()
    await flushAsync()

    expect(sidecar.synthesize.mock.calls.map((call) => call[1])).toEqual(['Вот пример.', 'Всё.'])
  })

  it('closes the utterance with a short silent final chunk when the last sentence had nothing to say', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    const stream = service.speakStream({ utteranceId: 'u7', voice: 'aidar', rate: 1 })
    stream.pushDelta('Готово. | a | b |')
    stream.finish()
    await flushAsync()

    const calls = sendAudioChunk.mock.calls.map((c) => c[0])
    expect(calls.map((c) => c.final)).toEqual([false, true])
    expect(calls[1].pcm.every((sample: number) => sample === 0)).toBe(true)
  })

  it('prewarm() spawns and warms the Silero sidecar without synthesizing anything', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
    const service = new CompanionTtsService('/tmp/userData', () => sidecar as never)

    await service.prewarm()

    expect(sidecar.warmUp).toHaveBeenCalledTimes(1)
    expect(sidecar.synthesize).not.toHaveBeenCalled()
  })

  it('prewarm() does nothing when the configured provider is Yandex', async () => {
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
      () => sidecar as never,
      () => ({
        provider: 'yandex',
        yandexVoice: 'kirill',
        maxSpokenChars: 250,
        yandexMonthlyBudgetRub: 300
      })
    )

    await service.prewarm()

    expect(sidecar.warmUp).not.toHaveBeenCalled()
  })
})

type FakeYandexSpeaker = {
  isAvailable: ReturnType<typeof vi.fn>
  synthesize: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function fakeYandexSpeaker(
  behavior: (id: string, text: string) => Promise<FakePcmChunk>
): FakeYandexSpeaker {
  return {
    isAvailable: vi.fn(() => true),
    synthesize: vi.fn(async (id: string, text: string) => behavior(id, text)),
    cancel: vi.fn()
  }
}

const YANDEX_PROVIDER_SETTINGS = {
  provider: 'yandex' as const,
  yandexVoice: 'kirill' as const,
  maxSpokenChars: 250,
  yandexMonthlyBudgetRub: 300
}

describe('CompanionTtsService — Yandex provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sendAudioChunk.mockClear()
    stopAudio.mockClear()
    sendTtsError.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('packs short sentences into one request and sends one final chunk', async () => {
    const yandex = fakeYandexSpeaker(async (_id, text) => pcmChunk([text.length]))
    const sidecar = fakeSidecar(async () => pcmChunk([1]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods CompanionTtsService calls on the sidecar.
      () => sidecar as never,
      () => YANDEX_PROVIDER_SETTINGS,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeYandexSpeaker mirrors only the methods CompanionTtsService calls on it.
      () => yandex as never
    )

    await service.speak('Привет. Как дела?', { utteranceId: 'y1', voice: 'eugene', rate: 1 })

    expect(yandex.synthesize).toHaveBeenCalledTimes(1)
    expect(sidecar.synthesize).not.toHaveBeenCalled()
    expect(sendAudioChunk).toHaveBeenCalledTimes(1)
    expect(sendAudioChunk.mock.calls[0][0].final).toBe(true)
  })

  it('falls back to Silero for a chunk when Yandex synthesis fails and Silero is provisioned', async () => {
    const yandex = fakeYandexSpeaker(async () => {
      throw new Error('yandex down')
    })
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => sidecar as never,
      () => YANDEX_PROVIDER_SETTINGS,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => yandex as never
    )

    await service.speak('Привет.', { utteranceId: 'y2', voice: 'eugene', rate: 1 })

    expect(yandex.synthesize).toHaveBeenCalledTimes(1)
    expect(sidecar.synthesize).toHaveBeenCalledTimes(1)
    expect(sendAudioChunk).toHaveBeenCalledTimes(1)
    expect(sendTtsError).not.toHaveBeenCalled()
  })

  it('skips the chunk and tells the panel in Russian when Yandex fails and Silero is not provisioned', async () => {
    vi.mocked(provisioning.readProvisionedModelPaths).mockResolvedValueOnce({
      v5ModelPath: null,
      v3ModelPath: null
    })
    const yandex = fakeYandexSpeaker(async () => {
      throw new Error('yandex down')
    })
    const sidecar = fakeSidecar(async () => pcmChunk([1]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => sidecar as never,
      () => YANDEX_PROVIDER_SETTINGS,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => yandex as never
    )

    await service.speak('Привет.', { utteranceId: 'y3', voice: 'eugene', rate: 1 })

    expect(sendAudioChunk).not.toHaveBeenCalled()
    expect(sendTtsError).toHaveBeenCalledTimes(1)
    expect(sendTtsError.mock.calls[0][0]).toMatch(/[а-яё]/i)
  })

  it('falls back to Silero entirely when no Yandex key is configured', async () => {
    const yandex = fakeYandexSpeaker(async () => pcmChunk([1]))
    yandex.isAvailable.mockReturnValue(false)
    const sidecar = fakeSidecar(async (_id, text) => pcmChunk([text.length]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => sidecar as never,
      () => YANDEX_PROVIDER_SETTINGS,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => yandex as never
    )

    await service.speak('Привет.', { utteranceId: 'y4', voice: 'eugene', rate: 1 })

    expect(yandex.synthesize).not.toHaveBeenCalled()
    expect(sidecar.synthesize).toHaveBeenCalledTimes(1)
  })

  it('stop() cancels an in-flight Yandex request and stops playback', async () => {
    const synthResolvers = Promise.withResolvers<FakePcmChunk>()
    synthResolvers.promise.catch(() => {})
    const yandex: FakeYandexSpeaker = {
      isAvailable: vi.fn(() => true),
      synthesize: vi.fn(() => synthResolvers.promise),
      cancel: vi.fn(() => synthResolvers.reject(new CompanionTtsCancelledError('y5:req')))
    }
    const sidecar = fakeSidecar(async () => pcmChunk([1]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => sidecar as never,
      () => YANDEX_PROVIDER_SETTINGS,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => yandex as never
    )

    const speaking = service.speak('Одно.', { utteranceId: 'y5', voice: 'eugene', rate: 1 })
    await flushAsync()
    service.stop('y5')

    expect(stopAudio).toHaveBeenCalledWith('y5')
    expect(yandex.cancel).toHaveBeenCalled()
    await speaking
    expect(sendAudioChunk).not.toHaveBeenCalled()
  })

  it('speakStream() packs streamed sentences and stops speaking past maxSpokenChars', async () => {
    const yandex = fakeYandexSpeaker(async (_id, text) => pcmChunk([text.length]))
    const sidecar = fakeSidecar(async () => pcmChunk([1]))
    const service = new CompanionTtsService(
      '/tmp/userData',
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => sidecar as never,
      () => ({ ...YANDEX_PROVIDER_SETTINGS, maxSpokenChars: 20 }),
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: see above.
      () => yandex as never
    )

    const stream = service.speakStream({ utteranceId: 'y6', voice: 'eugene', rate: 1 })
    stream.pushDelta('Первое предложение. ')
    stream.pushDelta('Второе предложение совсем не короткое. ')
    stream.pushDelta('Третье тоже.')
    stream.finish()
    await flushAsync()

    // Only the first (short) sentence fits under a 20-char cap; later ones are dropped.
    expect(yandex.synthesize).toHaveBeenCalledTimes(1)
    expect(sendAudioChunk).toHaveBeenCalledTimes(1)
    expect(sendAudioChunk.mock.calls[0][0].final).toBe(true)
  })
})
