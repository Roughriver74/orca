/** sherpa-onnx offline recognizer config for NeMo transducer exports such as GigaAM v3. */
export function buildNemoTransducerRecognizerConfig(args: {
  sampleRate: number
  encoder: string
  decoder: string
  joiner: string
  tokens: string
}) {
  return {
    // Why: GigaAM uses 64 mel bins, and sherpa-onnx only picks the NeMo transducer
    // decoder (different blank/state handling) when model_type is explicit.
    featConfig: { sampleRate: args.sampleRate, featureDim: 64 },
    modelConfig: {
      transducer: { encoder: args.encoder, decoder: args.decoder, joiner: args.joiner },
      tokens: args.tokens,
      modelType: 'nemo_transducer',
      numThreads: 2,
      provider: 'cpu',
      debug: 0
    },
    decodingMethod: 'greedy_search'
  }
}
