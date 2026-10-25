import { parentPort, workerData } from 'node:worker_threads'
import { WakeKeywordDetector, type KeywordSpotterBinding } from './wake-keyword-detector'

// Why its own worker rather than vad-worker.ts: the VAD worker lives and dies with one STT
// session (the companion restarts that per utterance), while keyword spotting must run on
// the uninterrupted mic stream — a restart would drop a wake phrase spanning it.

export type WakeKeywordWorkerMessage =
  | { type: 'init'; modelDir: string; phrases: string[] }
  | { type: 'feed'; samples: Float32Array; sampleRate: number }
  | { type: 'teardown' }

let detector: WakeKeywordDetector | null = null

function handleInit(msg: Extract<WakeKeywordWorkerMessage, { type: 'init' }>): void {
  try {
    const modulePath: unknown = workerData?.sherpaModulePath
    if (typeof modulePath !== 'string') {
      throw new Error('workerData.sherpaModulePath is required')
    }
    // SAFETY: the sherpa-onnx native addon ships no types; KeywordSpotterBinding lists exactly
    // the functions WakeKeywordDetector calls, all present in the bundled addon version.
    const binding = require(modulePath) as KeywordSpotterBinding
    detector = new WakeKeywordDetector(binding, msg)
    parentPort?.postMessage({ type: 'ready', skippedPhrases: detector.skippedPhrases })
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }
}

function handleFeed(msg: Extract<WakeKeywordWorkerMessage, { type: 'feed' }>): void {
  if (!detector) {
    return
  }
  try {
    const phrase = detector.feed(msg.samples, msg.sampleRate)
    if (phrase) {
      parentPort?.postMessage({ type: 'keyword', phrase })
    }
  } catch (err) {
    parentPort?.postMessage({ type: 'error', error: String(err) })
  }
}

parentPort?.on('message', (msg: WakeKeywordWorkerMessage) => {
  switch (msg.type) {
    case 'init':
      handleInit(msg)
      break
    case 'feed':
      handleFeed(msg)
      break
    case 'teardown':
      // Exits between messages, never inside a sherpa call (see sherpa-worker-shutdown.ts).
      process.exit(0)
  }
})
