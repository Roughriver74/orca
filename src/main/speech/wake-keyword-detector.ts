import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildWakeKeywordList,
  DECOY_LABEL_PREFIX,
  parseKeywordVocabulary
} from './wake-keyword-tokens'

/** The slice of the sherpa-onnx native addon the keyword spotter uses. */
export type KeywordSpotterBinding = {
  createKeywordSpotter: (config: Record<string, unknown>) => unknown
  createKeywordStream: (spotter: unknown) => unknown
  acceptWaveformOnline: (
    stream: unknown,
    waveform: { samples: Float32Array; sampleRate: number }
  ) => void
  isKeywordStreamReady: (spotter: unknown, stream: unknown) => boolean
  decodeKeywordStream: (spotter: unknown, stream: unknown) => void
  getKeywordResultAsJson: (spotter: unknown, stream: unknown) => string
}

const WAKE_KEYWORD_SAMPLE_RATE = 16000

// Why these decoding settings, measured on synthesized Russian speech at 48 kHz with each
// wake phrase after ~25 s of TV-style speech: 2 trailing blanks caught 55/60 phrases with
// 11 false hits, all on one sentence stuffed with near-homophones ("Джарвин, Дарвис,
// Джервис-Бей"); sherpa's default of 1 caught 53/60 with 27. More active paths or a lower
// threshold only added false hits. Inflected decoys (wake-keyword-tokens.ts) keep
// "в эту пятницу" from ever firing.
const KEYWORDS_THRESHOLD = 0.25
const TRAILING_BLANKS = 2

/**
 * sherpa-onnx KeywordSpotter over a Russian streaming transducer (the
 * 'wake-keyword-spotter-ru' focus model), fed the continuous mic stream. Runs inside
 * wake-keyword-worker.ts; kept as a class over an injected binding so it can be exercised
 * against the real addon directly.
 */
export class WakeKeywordDetector {
  private readonly spotter: unknown
  private stream: unknown
  private streamSampleRate: number | null = null
  /** Phrases the model's vocabulary cannot spell; never detected. */
  readonly skippedPhrases: string[]

  constructor(
    private readonly binding: KeywordSpotterBinding,
    options: { modelDir: string; phrases: readonly string[] }
  ) {
    const vocabulary = parseKeywordVocabulary(
      readFileSync(join(options.modelDir, 'tokens.txt'), 'utf8')
    )
    const { keywords, skipped } = buildWakeKeywordList(options.phrases, vocabulary)
    this.skippedPhrases = skipped
    if (keywords === '') {
      throw new Error(`No wake phrase is spellable by the keyword model: ${skipped.join(', ')}`)
    }
    this.spotter = binding.createKeywordSpotter({
      featConfig: { sampleRate: WAKE_KEYWORD_SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(options.modelDir, 'encoder.int8.onnx'),
          decoder: join(options.modelDir, 'decoder.onnx'),
          joiner: join(options.modelDir, 'joiner.int8.onnx')
        },
        tokens: join(options.modelDir, 'tokens.txt'),
        numThreads: 1,
        provider: 'cpu',
        debug: 0
      },
      maxActivePaths: 4,
      numTrailingBlanks: TRAILING_BLANKS,
      keywordsScore: 1,
      keywordsThreshold: KEYWORDS_THRESHOLD,
      keywordsBuf: keywords,
      keywordsBufSize: Buffer.byteLength(keywords)
    })
    this.stream = binding.createKeywordStream(this.spotter)
  }

  /** Feeds mono mic samples at their capture rate; returns the wake phrase heard, if any. */
  feed(samples: Float32Array, sampleRate: number): string | null {
    if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
      return null
    }
    // Why sherpa resamples, not stt-audio-resample.ts: that one interpolates without a
    // low-pass filter; sherpa's filters. Its stream aborts the process if the rate changes
    // mid-stream, so a device switch gets a new stream.
    if (sampleRate !== this.streamSampleRate) {
      this.stream = this.binding.createKeywordStream(this.spotter)
      this.streamSampleRate = sampleRate
    }
    this.binding.acceptWaveformOnline(this.stream, { samples, sampleRate })
    while (this.binding.isKeywordStreamReady(this.spotter, this.stream)) {
      this.binding.decodeKeywordStream(this.spotter, this.stream)
      const result: unknown = JSON.parse(
        this.binding.getKeywordResultAsJson(this.spotter, this.stream)
      )
      const keyword =
        typeof result === 'object' && result !== null && 'keyword' in result
          ? result.keyword
          : undefined
      if (typeof keyword !== 'string' || keyword === '') {
        continue
      }
      // Why a fresh stream rather than resetKeywordStream: replaying 90 synthesized phrases
      // back to back, fresh streams caught 89 with 3 false hits, reset 76 with 9; 8 hit-free
      // minutes of TV-style speech on one stream showed no drift. The rest of this chunk
      // (the tail of the phrase that just fired) is dropped with the old stream.
      this.stream = this.binding.createKeywordStream(this.spotter)
      return keyword.startsWith(DECOY_LABEL_PREFIX) ? null : keyword.replace(/_/g, ' ')
    }
    return null
  }
}
