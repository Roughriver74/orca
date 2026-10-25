import { describe, expect, it, vi } from 'vitest'
import {
  SpeakerEmbeddingExtractor,
  type SpeakerEmbeddingBinding
} from './speaker-embedding-extractor'

function makeFakeBinding(
  overrides: Partial<SpeakerEmbeddingBinding> = {}
): SpeakerEmbeddingBinding {
  return {
    createSpeakerEmbeddingExtractor: vi.fn(() => ({})),
    speakerEmbeddingExtractorDim: vi.fn(() => 192),
    speakerEmbeddingExtractorCreateStream: vi.fn(() => ({})),
    acceptWaveformOnline: vi.fn(),
    inputFinished: vi.fn(),
    speakerEmbeddingExtractorIsReady: vi.fn(() => true),
    speakerEmbeddingExtractorComputeEmbedding: vi.fn(() => new Float32Array([1, 2, 3])),
    ...overrides
  }
}

describe('SpeakerEmbeddingExtractor', () => {
  it('reads dim from the native binding at construction', () => {
    const binding = makeFakeBinding()
    const extractor = new SpeakerEmbeddingExtractor(binding, { modelPath: 'campplus.onnx' })
    expect(binding.createSpeakerEmbeddingExtractor).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'campplus.onnx' })
    )
    expect(extractor.dim).toBe(192)
  })

  it('computeEmbedding streams the samples, finishes input, and returns the embedding', () => {
    const binding = makeFakeBinding()
    const extractor = new SpeakerEmbeddingExtractor(binding, { modelPath: 'campplus.onnx' })
    const samples = new Float32Array([0.1, 0.2])

    const embedding = extractor.computeEmbedding(samples, 16000)

    expect(binding.acceptWaveformOnline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ samples, sampleRate: 16000 })
    )
    expect(binding.inputFinished).toHaveBeenCalledTimes(1)
    expect(embedding).toEqual(new Float32Array([1, 2, 3]))
  })

  it('does not pass enableExternalBuffer by default (the live VAD worker path)', () => {
    const binding = makeFakeBinding()
    const extractor = new SpeakerEmbeddingExtractor(binding, { modelPath: 'campplus.onnx' })
    extractor.computeEmbedding(new Float32Array([0.1]), 16000)
    expect(binding.speakerEmbeddingExtractorComputeEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything()
    )
  })

  it('passes enableExternalBuffer=false when copyBuffer is requested (main-thread enrollment)', () => {
    const binding = makeFakeBinding()
    const extractor = new SpeakerEmbeddingExtractor(binding, { modelPath: 'campplus.onnx' })
    extractor.computeEmbedding(new Float32Array([0.1]), 16000, true)
    expect(binding.speakerEmbeddingExtractorComputeEmbedding).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      false
    )
  })

  it('throws when the stream is not ready after inputFinished', () => {
    const binding = makeFakeBinding({ speakerEmbeddingExtractorIsReady: vi.fn(() => false) })
    const extractor = new SpeakerEmbeddingExtractor(binding, { modelPath: 'campplus.onnx' })
    expect(() => extractor.computeEmbedding(new Float32Array([0.1]), 16000)).toThrow(/not ready/)
  })
})
