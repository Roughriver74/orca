import { Worker } from 'node:worker_threads'
import { currentWorkerEntryLayout, resolveWorkerThreadEntryPath } from '../worker-thread-entry-path'
import { getSherpaModulePath } from './stt-worker-paths'
import { stopSherpaWorker, workerExited } from './sherpa-worker-shutdown'
import type { WakeKeywordWorkerMessage } from './wake-keyword-worker'

type WorkerOutMessage =
  | { type: 'ready'; skippedPhrases: string[] }
  | { type: 'error'; error: string }
  | { type: 'keyword'; phrase: string }

export type WakeKeywordSpotterHandlers = {
  onKeyword: (phrase: string) => void
  onError: (error: Error) => void
}

/**
 * Owns wake-keyword-worker.ts for as long as acoustic wake detection is on. Audio fed before
 * the model finishes loading (~0.5 s) is dropped: the stream is continuous, so the only cost
 * is a wake phrase spoken in that first half second.
 */
export class WakeKeywordSpotterService {
  private readonly worker: Worker
  private readonly exited: Promise<void>
  private ready = false
  private stopped = false

  constructor(
    options: { modelDir: string; phrases: string[] },
    handlers: WakeKeywordSpotterHandlers
  ) {
    this.worker = new Worker(
      resolveWorkerThreadEntryPath(currentWorkerEntryLayout(__dirname), 'wake-keyword-worker.js'),
      { workerData: { sherpaModulePath: getSherpaModulePath() } }
    )
    this.exited = workerExited(this.worker)
    this.worker.on('message', (msg: WorkerOutMessage) => {
      if (msg.type === 'ready') {
        this.ready = true
        if (msg.skippedPhrases.length > 0) {
          console.warn(
            '[companion] wake phrases the keyword model cannot spell',
            msg.skippedPhrases
          )
        }
      } else if (msg.type === 'keyword') {
        handlers.onKeyword(msg.phrase)
      } else {
        handlers.onError(new Error(msg.error))
      }
    })
    this.worker.on('error', (error: unknown) =>
      handlers.onError(error instanceof Error ? error : new Error(String(error)))
    )
    const init: WakeKeywordWorkerMessage = {
      type: 'init',
      modelDir: options.modelDir,
      phrases: options.phrases
    }
    this.worker.postMessage(init)
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.ready || this.stopped) {
      return
    }
    // Why copy + transfer: `samples` views the IPC Buffer's backing store, which structured
    // clone would copy whole; a compact copy moves to the worker without a second copy.
    const compact = new Float32Array(samples)
    const feed: WakeKeywordWorkerMessage = { type: 'feed', samples: compact, sampleRate }
    this.worker.postMessage(feed, [compact.buffer])
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return
    }
    this.stopped = true
    const teardown: WakeKeywordWorkerMessage = { type: 'teardown' }
    await stopSherpaWorker(this.worker, this.exited, teardown)
  }
}
