import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { CompanionQwenEmotion, CompanionTtsProvider } from '../../../shared/companion-types'
import { CompanionTtsCancelledError } from './companion-tts-sidecar-process'
import { CompanionTtsService } from './companion-tts-service'
import { QWEN3_EMOTION_INSTRUCT } from './companion-tts-service-qwen3'

vi.mock('../../../../resources/companion/tts-sidecar.py?asset&asarUnpack', () => ({
  default: '/fake/tts-sidecar.py'
}))
vi.mock('../../../../resources/companion/tts-qwen3-sidecar.py?asset&asarUnpack', () => ({
  default: '/fake/tts-qwen3-sidecar.py'
}))

type SentChunk = {
  seq: number
  final: boolean
  sampleRate: number
  pcm: Float32Array
}
const sendAudioChunk = vi.fn((_chunk: SentChunk) => {})
vi.mock('../companion-audio-output', () => ({
  sendAudioChunk: (chunk: SentChunk) => sendAudioChunk(chunk),
  stopAudio: vi.fn(),
  sendTtsError: vi.fn()
}))

vi.mock('./companion-tts-provisioning', () => ({
  getCompanionTtsPaths: (userDataDir: string) => ({
    rootDir: `${userDataDir}/companion-tts`,
    venvPythonPath: `${userDataDir}/companion-tts/venv/bin/python`
  }),
  readProvisionedModelPaths: vi.fn().mockResolvedValue({
    v5ModelPath: '/fake/v5.pt',
    v3ModelPath: '/fake/v3.pt',
    v56ModelPath: null
  })
}))

type ChunkCallback = (chunk: {
  requestId: string
  seq: number
  sampleRate: number
  final: boolean
  pcm: Float32Array
}) => void

type FakeSidecar = {
  synthesize: Mock
  cancel: Mock
  shutdown: Mock
  warmUp: Mock
  configs: unknown[]
}

function fakeSidecar(
  synthesize: (
    id: string,
    text: string,
    speaker: string,
    rate: number,
    onChunk: ChunkCallback,
    instruct?: string
  ) => Promise<void>
): FakeSidecar {
  return {
    synthesize: vi.fn(synthesize),
    cancel: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    warmUp: vi.fn().mockResolvedValue(undefined),
    configs: []
  }
}

/** Qwen3-like: two 24 kHz chunks per sentence, each carrying the sentence length. */
function streamingQwen(): FakeSidecar {
  return fakeSidecar(async (id, text, _speaker, _rate, onChunk) => {
    for (const seq of [0, 1]) {
      onChunk({
        requestId: id,
        seq,
        sampleRate: 24_000,
        final: false,
        pcm: new Float32Array([text.length])
      })
    }
  })
}

function sileroSidecar(): FakeSidecar {
  return fakeSidecar(async (id, _text, _speaker, _rate, onChunk) => {
    onChunk({
      requestId: id,
      seq: 0,
      sampleRate: 48_000,
      final: true,
      pcm: new Float32Array([7])
    })
  })
}

function makeService(options: {
  qwen: FakeSidecar
  silero?: FakeSidecar
  provider?: () => CompanionTtsProvider
  emotion?: CompanionQwenEmotion
  provisioned?: boolean
}) {
  const silero = options.silero ?? sileroSidecar()
  const provider = options.provider ?? (() => 'qwen3')
  return new CompanionTtsService(
    '/tmp/userData',
    (config) => {
      silero.configs.push(config)
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods the service calls on a sidecar.
      return silero as never
    },
    () => ({
      provider: provider(),
      yandexVoice: 'kirill',
      maxSpokenChars: 250,
      yandexMonthlyBudgetRub: 300,
      qwenEmotion: options.emotion ?? 'neutral'
    }),
    undefined,
    {
      sidecarFactory: (config) => {
        options.qwen.configs.push(config)
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods the service calls on a sidecar.
        return options.qwen as never
      },
      isProvisioned: () => options.provisioned ?? true
    }
  )
}

const sentChunks = () =>
  sendAudioChunk.mock.calls.map(([chunk]) => ({
    seq: chunk.seq,
    final: chunk.final,
    sampleRate: chunk.sampleRate,
    first: chunk.pcm[0]
  }))

describe('CompanionTtsService — Qwen3 provider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sendAudioChunk.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('streams every Qwen3 chunk as it arrives and closes the utterance with a final silence', async () => {
    const qwen = streamingQwen()
    const service = makeService({ qwen, emotion: 'mentor' })

    await service.speak('Открой *зам+ок*. Готово!', {
      utteranceId: 'u1',
      voice: 'eugene',
      rate: 1
    })

    expect(qwen.configs).toEqual([
      {
        pythonPath: '/tmp/userData/companion-tts/qwen3/venv/bin/python',
        scriptPath: '/fake/tts-qwen3-sidecar.py',
        scriptArgs: [
          '/tmp/userData/companion-tts/qwen3/models/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'
        ]
      }
    ])
    const [firstCall] = qwen.synthesize.mock.calls
    expect(firstCall[1]).not.toMatch(/[+*]/)
    expect(firstCall[2]).toBe('ryan')
    expect(firstCall[5]).toBe(QWEN3_EMOTION_INSTRUCT.mentor)
    const chunks = sentChunks()
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2, 3, 4])
    expect(chunks.map((c) => c.final)).toEqual([false, false, false, false, true])
    expect(chunks.every((c) => c.sampleRate === 24_000)).toBe(true)
    expect(chunks[4].first).toBe(0)
  })

  it('keeps sentence order in speakStream() and sends no instruct for neutral', async () => {
    const qwen = streamingQwen()
    const service = makeService({ qwen })

    const stream = service.speakStream({
      utteranceId: 'u2',
      voice: 'eugene',
      rate: 1
    })
    stream.pushDelta('Первое предложение готово. Второе')
    stream.pushDelta(' тоже готово!')
    stream.finish()
    await vi.waitFor(() => expect(sentChunks().at(-1)?.final).toBe(true))

    expect(qwen.synthesize.mock.calls.map((call) => call[1])).toEqual([
      'Первое предложение готово.',
      'Второе тоже готово!'
    ])
    expect(qwen.synthesize.mock.calls.every((call) => call[5] === undefined)).toBe(true)
    expect(sentChunks().map((c) => c.first)).toEqual([26, 26, 19, 19, 0])
  })

  it('speaks with Silero while Qwen3 is not provisioned', async () => {
    const qwen = streamingQwen()
    const silero = sileroSidecar()
    const service = makeService({ qwen, silero, provisioned: false })

    await service.speak('Привет.', {
      utteranceId: 'u3',
      voice: 'eugene',
      rate: 1
    })

    expect(qwen.synthesize).not.toHaveBeenCalled()
    expect(silero.synthesize).toHaveBeenCalledTimes(1)
    expect(sentChunks()).toEqual([{ seq: 0, final: true, sampleRate: 48_000, first: 7 }])
  })

  it('falls back to Silero for a sentence Qwen3 fails before any audio, keeping order', async () => {
    const qwen = fakeSidecar(async (id, text, _speaker, _rate, onChunk) => {
      if (text.startsWith('Сломается')) {
        throw new Error('metal out of memory')
      }
      onChunk({
        requestId: id,
        seq: 0,
        sampleRate: 24_000,
        final: false,
        pcm: new Float32Array([1])
      })
    })
    const silero = sileroSidecar()
    const service = makeService({ qwen, silero })

    await service.speak('Сломается на этом. А это скажет Qwen.', {
      utteranceId: 'u4',
      voice: 'eugene',
      rate: 1
    })

    expect(silero.synthesize).toHaveBeenCalledTimes(1)
    expect(sentChunks().map((c) => [c.sampleRate, c.first, c.final])).toEqual([
      [48_000, 7, false],
      [24_000, 1, false],
      [24_000, 0, true]
    ])
  })

  it('stops retrying a Qwen3 sidecar that failed to start until the cooldown passes', async () => {
    const qwen = streamingQwen()
    qwen.warmUp.mockRejectedValueOnce(new Error('No module named mlx_audio'))
    const silero = sileroSidecar()
    const service = makeService({ qwen, silero })

    await service.speak('Раз.', {
      utteranceId: 'u5',
      voice: 'eugene',
      rate: 1
    })
    await service.speak('Два.', {
      utteranceId: 'u6',
      voice: 'eugene',
      rate: 1
    })
    expect(qwen.warmUp).toHaveBeenCalledTimes(1)
    expect(silero.synthesize).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(10 * 60_000)
    await service.speak('Три.', {
      utteranceId: 'u7',
      voice: 'eugene',
      rate: 1
    })
    expect(qwen.synthesize).toHaveBeenCalledTimes(1)
  })

  it('cancels the in-flight Qwen3 request on stop() and sends nothing more', async () => {
    const pending = Promise.withResolvers<void>()
    const qwen = fakeSidecar(async (id, _text, _speaker, _rate, onChunk) => {
      onChunk({
        requestId: id,
        seq: 0,
        sampleRate: 24_000,
        final: false,
        pcm: new Float32Array([1])
      })
      await pending.promise
    })
    qwen.cancel.mockImplementation((requestId: string) =>
      pending.reject(new CompanionTtsCancelledError(requestId))
    )
    const service = makeService({ qwen })

    const speaking = service.speak('Длинная фраза.', {
      utteranceId: 'u8',
      voice: 'eugene',
      rate: 1
    })
    await vi.waitFor(() => expect(sendAudioChunk).toHaveBeenCalledTimes(1))
    service.stop('u8')
    await speaking

    expect(qwen.cancel).toHaveBeenCalledTimes(1)
    expect(sendAudioChunk).toHaveBeenCalledTimes(1)
  })

  it('speaks with Silero on a non-darwin-arm64 host even when qwen3 is selected', async () => {
    const realPlatform = process.platform
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true
    })
    try {
      const qwen = streamingQwen()
      const silero = sileroSidecar()
      const service = new CompanionTtsService(
        '/tmp/userData',
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods the service calls on a sidecar.
        () => silero as never,
        () => ({
          provider: 'qwen3',
          yandexVoice: 'kirill',
          maxSpokenChars: 250,
          yandexMonthlyBudgetRub: 300,
          qwenEmotion: 'warm'
        }),
        undefined,
        // Real provisioning check: the platform gate alone must keep Qwen3 off.
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: FakeSidecar mirrors only the methods the service calls on a sidecar.
        { sidecarFactory: () => qwen as never }
      )

      await service.prewarm()
      await service.speak('Привет.', {
        utteranceId: 'u10',
        voice: 'eugene',
        rate: 1
      })

      expect(qwen.warmUp).not.toHaveBeenCalled()
      expect(qwen.synthesize).not.toHaveBeenCalled()
      expect(silero.synthesize).toHaveBeenCalledTimes(1)
      expect(sentChunks()).toEqual([{ seq: 0, final: true, sampleRate: 48_000, first: 7 }])
    } finally {
      Object.defineProperty(process, 'platform', {
        value: realPlatform,
        configurable: true
      })
    }
  })

  it('shuts the Qwen3 sidecar down once another provider is selected', async () => {
    let provider: CompanionTtsProvider = 'qwen3'
    const qwen = streamingQwen()
    const service = makeService({ qwen, provider: () => provider })

    await service.prewarm()
    expect(qwen.warmUp).toHaveBeenCalledTimes(1)

    provider = 'silero'
    await service.speak('Привет.', {
      utteranceId: 'u9',
      voice: 'eugene',
      rate: 1
    })
    expect(qwen.shutdown).toHaveBeenCalledTimes(1)
  })
})
