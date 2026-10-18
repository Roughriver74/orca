import { EventEmitter } from 'node:events'
import { sendToCompanionWindow } from '../window/companion-window'
import type { CompanionAudioChunk, CompanionAudioState } from '../../shared/companion-types'

export type {
  CompanionAudioChunk,
  CompanionAudioPlaybackState,
  CompanionAudioState
} from '../../shared/companion-types'

const audioStateEmitter = new EventEmitter()

/** Streams one TTS chunk to the panel. The panel owns ordering/gapless playback per utteranceId. */
export function sendAudioChunk(chunk: CompanionAudioChunk): void {
  // Why: Float32Array is zeroed crossing the Electron IPC boundary (same issue as
  // speech:feedAudio) — wrap in a Buffer view to preserve bytes.
  sendToCompanionWindow('companion:audio-chunk', {
    utteranceId: chunk.utteranceId,
    seq: chunk.seq,
    sampleRate: chunk.sampleRate,
    final: chunk.final,
    pcm: Buffer.from(chunk.pcm.buffer, chunk.pcm.byteOffset, chunk.pcm.byteLength)
  })
}

/** Stops playback immediately; omit `utteranceId` to stop everything queued/playing. */
export function stopAudio(utteranceId?: string): void {
  sendToCompanionWindow('companion:audio-stop', { utteranceId })
}

/** Reported by the panel via the `companion:audio-state` IPC handler. */
export function reportAudioState(state: CompanionAudioState): void {
  audioStateEmitter.emit('audio-state', state)
}

export function onAudioState(listener: (state: CompanionAudioState) => void): () => void {
  audioStateEmitter.on('audio-state', listener)
  return () => audioStateEmitter.off('audio-state', listener)
}
