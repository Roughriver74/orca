import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (...args: unknown[]) => unknown

const { handleMock, removeHandlerMock, focusManagerMock, extractorComputeMock, resampleMock } =
  vi.hoisted(() => ({
    handleMock: vi.fn<(channel: string, listener: Handler) => void>(),
    removeHandlerMock: vi.fn(),
    focusManagerMock: {
      isReady: vi.fn(() => true),
      getModelPath: vi.fn(() => '/models/campplus.onnx'),
      getAllAssetStates: vi.fn(() => [{ id: 'silero-vad', status: 'ready' }]),
      download: vi.fn(async () => undefined)
    },
    extractorComputeMock: vi.fn(() => new Float32Array([1, 2, 3])),
    resampleMock: vi.fn((samples: Float32Array) => samples)
  }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/orca-userdata') },
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))

vi.mock('../companion/companion-voice-enrollment', () => ({
  addVoiceEnrollmentPhrase: vi.fn(),
  clearVoiceEnrollment: vi.fn(),
  getVoiceEnrollmentStatus: vi.fn(() => ({ enrolled: true, phraseCount: 1, updatedAt: 123 }))
}))

vi.mock('../speech/focus-model-manager', () => ({
  getFocusModelManager: vi.fn(() => focusManagerMock)
}))

vi.mock('../speech/stt-worker-paths', () => ({
  // Why 'node:path' and not a fake id: require() runs for real here (this file calls
  // `require(getSherpaModulePath())` directly, not through a worker) — any real,
  // always-resolvable module works since SpeakerEmbeddingExtractor itself is mocked
  // below and never inspects what gets passed as its "sherpa" binding.
  getSherpaModulePath: vi.fn(() => 'node:path')
}))

vi.mock('../speech/stt-audio-resample', () => ({
  resampleToRate: resampleMock
}))

vi.mock('../speech/speaker-embedding-extractor', () => ({
  SpeakerEmbeddingExtractor: vi.fn().mockImplementation(function MockExtractor(this: {
    computeEmbedding: typeof extractorComputeMock
  }) {
    this.computeEmbedding = extractorComputeMock
  })
}))

import {
  registerCompanionVoiceFocusHandlers,
  resetEnrollmentExtractorForTesting
} from './companion-voice-focus'
import {
  addVoiceEnrollmentPhrase,
  clearVoiceEnrollment
} from '../companion/companion-voice-enrollment'

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((entry) => entry[0] === channel)
  if (!call) {
    throw new Error(`${channel} handler not registered`)
  }
  return call[1]
}

describe('registerCompanionVoiceFocusHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    removeHandlerMock.mockReset()
    focusManagerMock.isReady.mockReturnValue(true)
    resetEnrollmentExtractorForTesting()
    registerCompanionVoiceFocusHandlers()
  })

  it('returns the enrollment status', async () => {
    const result = await getHandler('companion:voiceFocus:getEnrollmentStatus')({})
    expect(result).toEqual({ enrolled: true, phraseCount: 1, updatedAt: 123 })
  })

  it('refuses to enroll a phrase before the speaker-embedding model is ready', () => {
    focusManagerMock.isReady.mockReturnValue(false)
    const buffer = Buffer.from(new Float32Array([0.1, 0.2]).buffer)
    expect(() => getHandler('companion:voiceFocus:enrollPhrase')({}, buffer, 16000)).toThrow(
      'voice_focus_model_not_ready'
    )
  })

  it('resamples, computes, and persists an embedding for a new phrase', async () => {
    const samples = new Float32Array([0.1, 0.2, 0.3])
    const buffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)

    const result = await getHandler('companion:voiceFocus:enrollPhrase')({}, buffer, 44100)

    expect(resampleMock).toHaveBeenCalledWith(expect.any(Float32Array), 44100, 16000)
    expect(extractorComputeMock).toHaveBeenCalled()
    expect(addVoiceEnrollmentPhrase).toHaveBeenCalledWith(
      '/tmp/orca-userdata',
      new Float32Array([1, 2, 3])
    )
    expect(result).toEqual({ enrolled: true, phraseCount: 1, updatedAt: 123 })
  })

  it('clears the enrollment profile', async () => {
    const result = await getHandler('companion:voiceFocus:clearEnrollment')({})
    expect(clearVoiceEnrollment).toHaveBeenCalledWith('/tmp/orca-userdata')
    expect(result).toEqual({ enrolled: true, phraseCount: 1, updatedAt: 123 })
  })

  it('reports focus asset download states', async () => {
    const result = await getHandler('companion:voiceFocus:getAssetStatus')({})
    expect(result).toEqual([{ id: 'silero-vad', status: 'ready' }])
  })

  it('downloads a known asset on request', async () => {
    await getHandler('companion:voiceFocus:downloadAsset')({}, 'gtcrn-denoiser')
    expect(focusManagerMock.download).toHaveBeenCalledWith('gtcrn-denoiser')
  })

  it('rejects an unknown asset id', async () => {
    await expect(getHandler('companion:voiceFocus:downloadAsset')({}, 'bogus')).rejects.toThrow(
      /Unknown focus model/
    )
  })
})
