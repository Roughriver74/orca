/**
 * Thin, pure wrapper around the sherpa-onnx native addon's flat VAD API
 * (createVoiceActivityDetector / voiceActivityDetector*). The native binding is injected
 * so this class is unit-testable without the real .node addon — see vad-segmenter.test.ts.
 *
 * Native API shape (sherpa-onnx-darwin-arm64 1.12.37, confirmed against
 * k2-fsa/sherpa-onnx scripts/node-addon-api/lib/vad.js + types.js):
 *   createVoiceActivityDetector(config: VadConfig, bufferSizeInSeconds: number): handle
 *   voiceActivityDetectorAcceptWaveform(handle, samples: Float32Array): void
 *   voiceActivityDetectorIsEmpty(handle): boolean
 *   voiceActivityDetectorFront(handle, enableExternalBuffer?): { start: number; samples: Float32Array }
 *   voiceActivityDetectorPop(handle): void
 *   voiceActivityDetectorFlush(handle): void  // force the in-progress segment into the queue
 *   voiceActivityDetectorReset(handle): void
 */
export type VadBinding = {
  createVoiceActivityDetector: (config: unknown, bufferSizeInSeconds: number) => unknown
  voiceActivityDetectorAcceptWaveform: (handle: unknown, samples: Float32Array) => void
  voiceActivityDetectorIsEmpty: (handle: unknown) => boolean
  voiceActivityDetectorFront: (
    handle: unknown,
    enableExternalBuffer?: boolean
  ) => { start: number; samples: Float32Array }
  voiceActivityDetectorPop: (handle: unknown) => void
  voiceActivityDetectorFlush: (handle: unknown) => void
  voiceActivityDetectorReset: (handle: unknown) => void
}

export type VadSegment = {
  /** Sample index (at VAD sample rate) where the segment started. */
  startSample: number
  samples: Float32Array
}

export type VadSegmenterOptions = {
  modelPath: string
  /** Silero VAD requires 16 kHz; caller resamples before feed(). */
  sampleRate?: number
  /** Trailing silence (s) before a segment is considered finished. */
  endOfUtteranceSeconds: number
  /** Safety cap: a segment this long is force-finished even without silence
   *  (native sileroVad.maxSpeechDuration — no hand-rolled timer needed). */
  maxUtteranceSeconds: number
  /** Speech-probability threshold; sherpa-onnx default 0.5. */
  threshold?: number
  /** Minimum speech duration (s) to not be treated as a noise blip; sherpa-onnx default 0.25. */
  minSpeechDurationSeconds?: number
  /** Silero v5 requires 512 for 16 kHz; v4 uses 512 too for 16 kHz input. */
  windowSize?: number
  /** Ring buffer size backing the detector's internal segment queue. */
  bufferSizeInSeconds?: number
}

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_THRESHOLD = 0.5
const DEFAULT_MIN_SPEECH_DURATION_SECONDS = 0.25
const DEFAULT_WINDOW_SIZE = 512
const DEFAULT_BUFFER_SIZE_SECONDS = 30

export class VadSegmenter {
  private readonly binding: VadBinding
  private readonly handle: unknown

  constructor(binding: VadBinding, options: VadSegmenterOptions) {
    this.binding = binding
    this.handle = binding.createVoiceActivityDetector(
      {
        sileroVad: {
          model: options.modelPath,
          threshold: options.threshold ?? DEFAULT_THRESHOLD,
          minSilenceDuration: options.endOfUtteranceSeconds,
          minSpeechDuration:
            options.minSpeechDurationSeconds ?? DEFAULT_MIN_SPEECH_DURATION_SECONDS,
          windowSize: options.windowSize ?? DEFAULT_WINDOW_SIZE,
          maxSpeechDuration: options.maxUtteranceSeconds
        },
        sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
        numThreads: 1,
        provider: 'cpu',
        debug: 0
      },
      options.bufferSizeInSeconds ?? DEFAULT_BUFFER_SIZE_SECONDS
    )
  }

  private drainQueue(): VadSegment[] {
    const segments: VadSegment[] = []
    while (!this.binding.voiceActivityDetectorIsEmpty(this.handle)) {
      // Electron's V8 sandbox rejects external ArrayBuffers; false makes the addon copy.
      const front = this.binding.voiceActivityDetectorFront(this.handle, false)
      segments.push({ startSample: front.start, samples: front.samples })
      this.binding.voiceActivityDetectorPop(this.handle)
    }
    return segments
  }

  /** Feeds 16 kHz samples; returns any segments the VAD finished as a result. */
  feed(samples: Float32Array): VadSegment[] {
    this.binding.voiceActivityDetectorAcceptWaveform(this.handle, samples)
    return this.drainQueue()
  }

  /** Forces the in-progress segment to finish now: hotkey-while-speaking, or a caller-side
   *  max-utterance safety net on top of the native maxSpeechDuration. Returns it if non-empty. */
  finalizeNow(): VadSegment[] {
    this.binding.voiceActivityDetectorFlush(this.handle)
    return this.drainQueue()
  }

  reset(): void {
    this.binding.voiceActivityDetectorReset(this.handle)
  }
}
