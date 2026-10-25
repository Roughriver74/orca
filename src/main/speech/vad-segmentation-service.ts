import { Worker } from 'node:worker_threads'
import { getSherpaModulePath, getVadWorkerPath } from './stt-worker-paths'

export type VadSegmentationOptions = {
  vadModelPath: string
  endOfUtteranceSeconds: number
  maxUtteranceSeconds: number
  /** Omitted = sherpa-onnx's default minimum speech duration. */
  minSpeechDurationSeconds?: number
  /** Omitted = no speaker verification for this session. */
  speakerEmbeddingModelPath?: string
  /** Omitted = no denoising ahead of VAD. */
  denoiserModelPath?: string
}

export type VadSegmentResult = {
  durationMs: number
  /** null when no speaker-embedding model was configured, or extraction failed. */
  embedding: number[] | null
}

type WorkerOutMessage =
  | { type: 'ready' }
  | { type: 'error'; error: string }
  | { type: 'segmentEnd'; durationMs: number; embedding: number[] | null }
  | { type: 'activity'; speech: boolean }

/**
 * Owns the vad-worker.ts Worker for one dictation session: feeds it the same raw mic
 * audio SttService.feedAudio receives, and reports finished speech segments (with an
 * optional speaker embedding) back to the caller. Deliberately standalone rather than
 * threaded through stt-session-start/stop/state.ts: those already carry a lot of
 * lifecycle complexity (warm-worker reuse, idle teardown, stop-in-flight dedupe) that VAD
 * segmentation does not need to share — it lives and dies with one SttService session.
 */
export class VadSegmentationService {
  private worker: Worker
  private isReady = false
  private stopped = false
  // Why queue instead of dropping pre-ready audio: VAD init (a tiny model) is fast but
  // not instant, and the first word of an utterance matters for segmentation.
  private feedQueue: { samples: Float32Array; sampleRate: number }[] = []

  constructor(
    options: VadSegmentationOptions,
    onSegment: (segment: VadSegmentResult) => void,
    onError?: (error: Error) => void,
    /** Given = the worker reports, after every feed, whether speech is in progress. */
    onActivity?: (speech: boolean) => void
  ) {
    this.worker = new Worker(getVadWorkerPath(), {
      workerData: { sherpaModulePath: getSherpaModulePath() }
    })

    this.worker.on('message', (msg: WorkerOutMessage) => {
      switch (msg.type) {
        case 'ready':
          this.isReady = true
          for (const chunk of this.feedQueue) {
            this.worker.postMessage({ type: 'feed', ...chunk })
          }
          this.feedQueue = []
          break
        case 'error':
          onError?.(new Error(msg.error))
          break
        case 'segmentEnd':
          onSegment({ durationMs: msg.durationMs, embedding: msg.embedding })
          break
        case 'activity':
          onActivity?.(msg.speech)
          break
      }
    })
    this.worker.on('error', (error: unknown) =>
      onError?.(error instanceof Error ? error : new Error(String(error)))
    )

    this.worker.postMessage({
      type: 'init',
      vadModelPath: options.vadModelPath,
      endOfUtteranceSeconds: options.endOfUtteranceSeconds,
      maxUtteranceSeconds: options.maxUtteranceSeconds,
      minSpeechDurationSeconds: options.minSpeechDurationSeconds,
      reportActivity: onActivity !== undefined,
      speakerEmbeddingModelPath: options.speakerEmbeddingModelPath,
      denoiserModelPath: options.denoiserModelPath
    })
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (this.stopped) {
      return
    }
    if (this.isReady) {
      this.worker.postMessage({ type: 'feed', samples, sampleRate })
      return
    }
    this.feedQueue.push({ samples, sampleRate })
  }

  /** Forces the in-progress segment to finish now: hotkey-while-speaking, or a panel-side
   *  max-utterance safety net on top of the native maxSpeechDuration. No-op before ready
   *  (nothing has accumulated in the detector yet). */
  finalizeNow(): void {
    if (this.stopped || !this.isReady) {
      return
    }
    this.worker.postMessage({ type: 'finalizeNow' })
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    this.feedQueue = []
    await this.worker.terminate()
  }
}
