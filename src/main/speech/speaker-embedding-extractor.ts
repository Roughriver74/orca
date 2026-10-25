/**
 * Thin, pure wrapper around the sherpa-onnx native addon's speaker-embedding API,
 * injectable for unit tests. Confirmed against k2-fsa/sherpa-onnx
 * scripts/node-addon-api/lib/speaker-identification.js + streaming-asr.js (the extractor's
 * stream reuses the same acceptWaveformOnline/inputFinished calls as online ASR streams).
 *
 *   createSpeakerEmbeddingExtractor(config: { model, numThreads, debug, provider }): handle
 *   speakerEmbeddingExtractorDim(handle): number
 *   speakerEmbeddingExtractorCreateStream(handle): streamHandle
 *   acceptWaveformOnline(streamHandle, { samples, sampleRate }): void
 *   inputFinished(streamHandle): void
 *   speakerEmbeddingExtractorIsReady(handle, streamHandle): boolean
 *   speakerEmbeddingExtractorComputeEmbedding(handle, streamHandle, enableExternalBuffer?): Float32Array
 */
export type SpeakerEmbeddingBinding = {
  createSpeakerEmbeddingExtractor: (config: unknown) => unknown
  speakerEmbeddingExtractorDim: (handle: unknown) => number
  speakerEmbeddingExtractorCreateStream: (handle: unknown) => unknown
  acceptWaveformOnline: (
    streamHandle: unknown,
    waveform: { samples: Float32Array; sampleRate: number }
  ) => void
  inputFinished: (streamHandle: unknown) => void
  speakerEmbeddingExtractorIsReady: (handle: unknown, streamHandle: unknown) => boolean
  speakerEmbeddingExtractorComputeEmbedding: (
    handle: unknown,
    streamHandle: unknown,
    enableExternalBuffer?: boolean
  ) => Float32Array
}

export type SpeakerEmbeddingExtractorOptions = {
  modelPath: string
}

export class SpeakerEmbeddingExtractor {
  private readonly binding: SpeakerEmbeddingBinding
  private readonly handle: unknown
  readonly dim: number

  constructor(binding: SpeakerEmbeddingBinding, options: SpeakerEmbeddingExtractorOptions) {
    this.binding = binding
    this.handle = binding.createSpeakerEmbeddingExtractor({
      model: options.modelPath,
      numThreads: 1,
      debug: 0,
      provider: 'cpu'
    })
    this.dim = binding.speakerEmbeddingExtractorDim(this.handle)
  }

  /** Computes a speaker embedding for one utterance's worth of samples.
   *  `copyBuffer`: false (default) matches what shipped before and what the live VAD
   *  worker still uses — passing enableExternalBuffer=false there crashed a worker thread
   *  with a native SIGABRT in napi_is_detached_arraybuffer, unverified against real speech
   *  (#orca-build-local 2026-10-25). The one-shot main-thread enrollment call (`true`) was
   *  verified fixed under Electron: without it, Electron's V8 sandbox rejects the addon's
   *  external ArrayBuffer with "External buffers are not allowed". */
  computeEmbedding(samples: Float32Array, sampleRate: number, copyBuffer = false): Float32Array {
    const stream = this.binding.speakerEmbeddingExtractorCreateStream(this.handle)
    this.binding.acceptWaveformOnline(stream, { samples, sampleRate })
    this.binding.inputFinished(stream)
    if (!this.binding.speakerEmbeddingExtractorIsReady(this.handle, stream)) {
      throw new Error('Speaker embedding extractor stream not ready after inputFinished')
    }
    return copyBuffer
      ? this.binding.speakerEmbeddingExtractorComputeEmbedding(this.handle, stream, false)
      : this.binding.speakerEmbeddingExtractorComputeEmbedding(this.handle, stream)
  }
}
