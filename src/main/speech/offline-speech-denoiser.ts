/**
 * Thin, pure wrapper around the sherpa-onnx native addon's offline speech-denoiser API
 * (GTCRN), injectable for unit tests. Confirmed against k2-fsa/sherpa-onnx
 * scripts/node-addon-api/lib/non-streaming-speech-denoiser.js + types.js.
 *
 *   createOfflineSpeechDenoiser(config: { model: { gtcrn: { model }, numThreads, debug, provider } }): handle
 *   offlineSpeechDenoiserGetSampleRateWrapper(handle): number
 *   offlineSpeechDenoiserRunWrapper(handle, { samples, sampleRate, enableExternalBuffer? }): { samples, sampleRate }
 */
export type OfflineSpeechDenoiserBinding = {
  createOfflineSpeechDenoiser: (config: unknown) => unknown
  offlineSpeechDenoiserGetSampleRateWrapper: (handle: unknown) => number
  offlineSpeechDenoiserRunWrapper: (
    handle: unknown,
    request: { samples: Float32Array; sampleRate: number; enableExternalBuffer?: boolean }
  ) => { samples: Float32Array; sampleRate: number }
}

export type OfflineSpeechDenoiserOptions = {
  modelPath: string
}

export class OfflineSpeechDenoiser {
  private readonly binding: OfflineSpeechDenoiserBinding
  private readonly handle: unknown
  readonly sampleRate: number

  constructor(binding: OfflineSpeechDenoiserBinding, options: OfflineSpeechDenoiserOptions) {
    this.binding = binding
    this.handle = binding.createOfflineSpeechDenoiser({
      model: { gtcrn: { model: options.modelPath }, numThreads: 1, debug: 0, provider: 'cpu' }
    })
    this.sampleRate = binding.offlineSpeechDenoiserGetSampleRateWrapper(this.handle)
  }

  run(samples: Float32Array, sampleRate: number): Float32Array {
    return this.binding.offlineSpeechDenoiserRunWrapper(this.handle, { samples, sampleRate })
      .samples
  }
}
