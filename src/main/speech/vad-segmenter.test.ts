import { describe, expect, it, vi } from 'vitest'
import { VadSegmenter, type VadBinding } from './vad-segmenter'

function makeFakeBinding(): {
  binding: VadBinding
  queue: { start: number; samples: Float32Array }[]
} {
  const queue: { start: number; samples: Float32Array }[] = []
  const binding: VadBinding = {
    createVoiceActivityDetector: vi.fn(() => ({})),
    voiceActivityDetectorAcceptWaveform: vi.fn(),
    voiceActivityDetectorIsEmpty: vi.fn(() => queue.length === 0),
    voiceActivityDetectorFront: vi.fn(() => queue[0]!),
    voiceActivityDetectorPop: vi.fn(() => {
      queue.shift()
    }),
    voiceActivityDetectorFlush: vi.fn(),
    voiceActivityDetectorReset: vi.fn(),
    voiceActivityDetectorIsDetected: vi.fn(() => false)
  }
  return { binding, queue }
}

describe('VadSegmenter', () => {
  it('maps endOfUtteranceSeconds/maxUtteranceSeconds to the native sileroVad config', () => {
    const { binding } = makeFakeBinding()
    new VadSegmenter(binding, {
      modelPath: '/models/silero_vad_v5.onnx',
      endOfUtteranceSeconds: 1.5,
      maxUtteranceSeconds: 45
    })
    expect(binding.createVoiceActivityDetector).toHaveBeenCalledWith(
      expect.objectContaining({
        sileroVad: expect.objectContaining({
          model: '/models/silero_vad_v5.onnx',
          minSilenceDuration: 1.5,
          maxSpeechDuration: 45
        }),
        sampleRate: 16000
      }),
      expect.any(Number)
    )
  })

  it('feed() drains every queued segment and returns them', () => {
    const { binding, queue } = makeFakeBinding()
    const segmenter = new VadSegmenter(binding, {
      modelPath: 'model.onnx',
      endOfUtteranceSeconds: 1,
      maxUtteranceSeconds: 30
    })
    const samplesA = new Float32Array([0.1, 0.2])
    const samplesB = new Float32Array([0.3])
    queue.push({ start: 0, samples: samplesA }, { start: 100, samples: samplesB })

    const segments = segmenter.feed(new Float32Array(512))

    expect(binding.voiceActivityDetectorAcceptWaveform).toHaveBeenCalledTimes(1)
    expect(segments).toEqual([
      { startSample: 0, samples: samplesA },
      { startSample: 100, samples: samplesB }
    ])
    expect(queue).toHaveLength(0)
  })

  it('feed() returns an empty array while no segment has finished yet', () => {
    const { binding } = makeFakeBinding()
    const segmenter = new VadSegmenter(binding, {
      modelPath: 'model.onnx',
      endOfUtteranceSeconds: 1,
      maxUtteranceSeconds: 30
    })
    expect(segmenter.feed(new Float32Array(512))).toEqual([])
  })

  it('finalizeNow() flushes the detector and drains whatever that produced', () => {
    const { binding, queue } = makeFakeBinding()
    const segmenter = new VadSegmenter(binding, {
      modelPath: 'model.onnx',
      endOfUtteranceSeconds: 1,
      maxUtteranceSeconds: 30
    })
    const samples = new Float32Array([0.5])
    // Why push after construction but check call order: flush() is what's supposed to
    // produce the in-progress segment — simulate that by having the fake queue it only
    // once flush is observed.
    vi.mocked(binding.voiceActivityDetectorFlush).mockImplementationOnce(() => {
      queue.push({ start: 42, samples })
    })

    const segments = segmenter.finalizeNow()

    expect(binding.voiceActivityDetectorFlush).toHaveBeenCalledTimes(1)
    expect(segments).toEqual([{ startSample: 42, samples }])
  })

  it('finalizeNow() with nothing in progress returns an empty array', () => {
    const { binding } = makeFakeBinding()
    const segmenter = new VadSegmenter(binding, {
      modelPath: 'model.onnx',
      endOfUtteranceSeconds: 1,
      maxUtteranceSeconds: 30
    })
    expect(segmenter.finalizeNow()).toEqual([])
  })

  it('reset() delegates to the native reset call', () => {
    const { binding } = makeFakeBinding()
    const segmenter = new VadSegmenter(binding, {
      modelPath: 'model.onnx',
      endOfUtteranceSeconds: 1,
      maxUtteranceSeconds: 30
    })
    segmenter.reset()
    expect(binding.voiceActivityDetectorReset).toHaveBeenCalledTimes(1)
  })
})
