import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../../resources/companion/tts-sidecar.py?asset&asarUnpack', () => ({
  default: '/fake/tts-sidecar.py'
}))

const sendAudioChunk = vi.fn()
const stopAudio = vi.fn()
vi.mock('../companion-audio-output', () => ({
  sendAudioChunk: (...args: unknown[]) => sendAudioChunk(...args),
  stopAudio: (...args: unknown[]) => stopAudio(...args)
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
    isHealthy: vi.fn().mockReturnValue(true)
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
      isHealthy: vi.fn().mockReturnValue(true)
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
})
