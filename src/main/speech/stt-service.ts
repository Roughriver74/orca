import type { ModelManager } from './model-manager'
import { startSttDictation } from './stt-session-start'
import { createSttSessionState, type SttSessionState } from './stt-session-state'
import { prepareSttModelForDeletion, stopSttDictation } from './stt-session-stop'
import { VadSegmentationService, type VadSegmentationOptions } from './vad-segmentation-service'

export { IDLE_WORKER_TEARDOWN_MS, START_DICTATION_TIMEOUT_MS } from './stt-session-timeouts'

export type SttEvent =
  | { type: 'ready' }
  | { type: 'partial'; text?: string }
  | { type: 'final'; text?: string }
  | { type: 'stopped' }
  | { type: 'error'; error?: string }
  // Fired when the Silero VAD (vad-worker.ts, fed the same audio as feedAudio) detects
  // end-of-speech, or SttService.finalizeNow(owner) force-flushes it — see
  // VadSegmentationService. `embedding` is the finished segment's speaker embedding
  // (null when no speaker-embedding model is configured for this session).
  | { type: 'segmentEnd'; embedding?: number[] | null }

export type SttEventSink = (event: SttEvent) => void

export class SttService {
  private readonly state: SttSessionState
  private vadService: VadSegmentationService | null = null

  constructor(modelManager: ModelManager) {
    this.state = createSttSessionState(modelManager)
  }

  startDictation(
    modelId: string,
    sink: SttEventSink,
    hotwordsFilePath?: string,
    owner = 'desktop',
    vadOptions?: VadSegmentationOptions
  ): Promise<void> {
    this.vadService?.stop().catch(() => undefined)
    this.vadService = vadOptions
      ? new VadSegmentationService(
          vadOptions,
          (segment) => sink({ type: 'segmentEnd', embedding: segment.embedding }),
          (error) => console.error('[voiceFocus] VAD segmentation failed', error)
        )
      : null
    return startSttDictation(this.state, modelId, sink, hotwordsFilePath, owner)
  }

  feedAudio(samples: Float32Array, sampleRate: number, owner = 'desktop'): void {
    if (this.state.stopping) {
      return
    }
    const currentOwner = this.state.activeOwner ?? this.state.startingOwner
    if (!currentOwner) {
      return
    }
    if (currentOwner !== owner) {
      throw new Error('dictation_owner_mismatch')
    }
    // Why copy before any transfer: feedAudio hands `samples.buffer` to the STT worker
    // below with a zero-copy structured-clone transfer, which detaches it — the VAD
    // worker needs its own copy of the same audio, taken before that detach.
    this.vadService?.feed(new Float32Array(samples), sampleRate)
    if (this.state.cloudSession) {
      this.state.cloudSession.feedAudio(samples, sampleRate)
      return
    }
    this.state.worker?.postMessage({ type: 'feed', samples, sampleRate }, [
      samples.buffer as ArrayBuffer
    ])
  }

  /** Forces the current in-progress VAD segment to finish now: hotkey-while-speaking, or
   *  a caller-side max-utterance safety net. No-op when VAD segmentation is not active
   *  for this session (e.g. the model is not downloaded yet). */
  finalizeNow(): void {
    this.vadService?.finalizeNow()
  }

  stopDictation(
    owner = 'desktop',
    options: { cancelStarting?: boolean } = { cancelStarting: true }
  ): Promise<void> {
    const vad = this.vadService
    this.vadService = null
    // Why not await VAD first: the stop message must reach the STT worker synchronously so
    // concurrent stop callers share it; the VAD worker shuts down alongside.
    const sttStopped = stopSttDictation(this.state, owner, options)
    if (!vad) {
      return sttStopped
    }
    const vadStopped = vad.stop().catch((error: unknown) => {
      console.error('[voiceFocus] VAD stop failed', error)
    })
    return Promise.all([sttStopped, vadStopped]).then(() => undefined)
  }

  isActive(): boolean {
    return this.state.worker !== null || this.state.cloudSession !== null
  }

  getActiveModelId(): string | null {
    return this.state.activeModelId
  }

  prepareModelForDeletion(modelId: string): Promise<void> {
    return prepareSttModelForDeletion(this.state, modelId)
  }
}
