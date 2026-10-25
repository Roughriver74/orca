/* oxlint-disable typescript-eslint/no-explicit-any -- sherpa-onnx native addon has no type definitions */
import { parentPort, workerData } from 'node:worker_threads'
import { resampleToRate } from './stt-audio-resample'
import { VadSegmenter, type VadSegment } from './vad-segmenter'
import { SpeakerEmbeddingExtractor } from './speaker-embedding-extractor'
import { OfflineSpeechDenoiser } from './offline-speech-denoiser'

// Why a sibling worker rather than folding this into stt-worker.ts: the STT worker's
// init/feed/stop lifecycle (offline chunker, warm-worker reuse, model-type branching) is
// already dense and shared with the dictation-restart flow; running VAD segmentation here
// keeps that file untouched while still consuming the exact same raw mic audio stream
// (VadSegmentationService.feed mirrors every SttService.feedAudio call to this worker too).

const VAD_SAMPLE_RATE = 16000

type WorkerMessage =
  | {
      type: 'init'
      vadModelPath: string
      endOfUtteranceSeconds: number
      maxUtteranceSeconds: number
      minSpeechDurationSeconds?: number
      /** Post `{ type: 'activity', speech }` after every feed (voice barge-in confirmation). */
      reportActivity?: boolean
      speakerEmbeddingModelPath?: string
      denoiserModelPath?: string
    }
  | { type: 'feed'; samples: Float32Array; sampleRate: number }
  | { type: 'finalizeNow' }
  | { type: 'teardown' }

let sherpa: any = null
let segmenter: VadSegmenter | null = null
let speakerExtractor: SpeakerEmbeddingExtractor | null = null
let denoiser: OfflineSpeechDenoiser | null = null
let reportActivity = false

function loadSherpa(): any {
  const modulePath = workerData?.sherpaModulePath
  if (!modulePath) {
    throw new Error('workerData.sherpaModulePath is required')
  }
  return require(modulePath)
}

function handleInit(msg: Extract<WorkerMessage, { type: 'init' }>): void {
  try {
    sherpa = loadSherpa()
    segmenter = new VadSegmenter(sherpa, {
      modelPath: msg.vadModelPath,
      sampleRate: VAD_SAMPLE_RATE,
      endOfUtteranceSeconds: msg.endOfUtteranceSeconds,
      maxUtteranceSeconds: msg.maxUtteranceSeconds,
      minSpeechDurationSeconds: msg.minSpeechDurationSeconds
    })
    reportActivity = msg.reportActivity === true
    speakerExtractor = msg.speakerEmbeddingModelPath
      ? new SpeakerEmbeddingExtractor(sherpa, { modelPath: msg.speakerEmbeddingModelPath })
      : null
    denoiser = msg.denoiserModelPath
      ? new OfflineSpeechDenoiser(sherpa, { modelPath: msg.denoiserModelPath })
      : null
    parentPort?.postMessage({ type: 'ready' })
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }
}

function emitSegment(segment: VadSegment): void {
  let embedding: Float32Array | null = null
  if (speakerExtractor) {
    try {
      embedding = speakerExtractor.computeEmbedding(segment.samples, VAD_SAMPLE_RATE)
    } catch (err) {
      // Why swallow: a failed embedding must not drop the segment itself — verification
      // just treats it as "no embedding" (fail-open, see companion-voice-focus.ts).
      console.error('[voiceFocus] speaker embedding failed', err)
    }
  }
  const durationMs = (segment.samples.length / VAD_SAMPLE_RATE) * 1000
  const payload = {
    type: 'segmentEnd',
    durationMs,
    embedding: embedding ? Array.from(embedding) : null
  }
  parentPort?.postMessage(payload)
}

function handleFeed(msg: Extract<WorkerMessage, { type: 'feed' }>): void {
  if (!segmenter) {
    return
  }
  let samples = resampleToRate(msg.samples, msg.sampleRate, VAD_SAMPLE_RATE)
  if (denoiser) {
    try {
      samples = resampleToRate(
        denoiser.run(
          resampleToRate(samples, VAD_SAMPLE_RATE, denoiser.sampleRate),
          denoiser.sampleRate
        ),
        denoiser.sampleRate,
        VAD_SAMPLE_RATE
      )
    } catch (err) {
      console.error('[voiceFocus] denoiser failed, feeding raw audio to VAD', err)
    }
  }
  for (const segment of segmenter.feed(samples)) {
    emitSegment(segment)
  }
  if (reportActivity) {
    parentPort?.postMessage({ type: 'activity', speech: segmenter.isSpeechDetected() })
  }
}

function handleFinalizeNow(): void {
  if (!segmenter) {
    return
  }
  for (const segment of segmenter.finalizeNow()) {
    emitSegment(segment)
  }
}

parentPort?.on('message', (msg: WorkerMessage) => {
  switch (msg.type) {
    case 'init':
      handleInit(msg)
      break
    case 'feed':
      handleFeed(msg)
      break
    case 'finalizeNow':
      handleFinalizeNow()
      break
    case 'teardown':
      process.exit(0)
  }
})
