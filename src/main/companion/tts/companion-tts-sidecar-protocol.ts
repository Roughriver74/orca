// Parses the sidecar's stdout protocol: a JSON header line per frame, and for audio
// frames the header is immediately followed by exactly `bytes` raw little-endian
// float32 PCM with no separator. See resources/companion/tts-sidecar.py for why this
// is length-prefixed binary rather than base64 (an utterance runs to hundreds of KB,
// streamed per sentence across a whole conversation).

import { isRecord } from '../../../shared/agent-status-child-work-value-guards'

export type CompanionTtsSidecarFrame =
  | { type: 'ready' }
  | {
      type: 'audio'
      id: string
      seq: number
      sampleRate: number
      final: boolean
      pcm: Float32Array
    }
  | { type: 'done'; id: string }
  | { type: 'error'; id: string | null; message: string }

function decodeHeaderFrame(header: Record<string, unknown>): CompanionTtsSidecarFrame | null {
  if (header.type === 'ready') {
    return { type: 'ready' }
  }
  if (header.type === 'done' && typeof header.id === 'string') {
    return { type: 'done', id: header.id }
  }
  if (header.type === 'error' && typeof header.message === 'string') {
    return {
      type: 'error',
      id: typeof header.id === 'string' ? header.id : null,
      message: header.message
    }
  }
  return null
}

/**
 * Feed raw stdout chunks via the returned function; `onFrame` fires once per complete
 * frame, in order. Audio frames are only emitted once their full PCM payload has
 * arrived, so a caller never sees a header without matching bytes.
 */
export function createCompanionTtsSidecarFrameReader(
  onFrame: (frame: CompanionTtsSidecarFrame) => void
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0)
  let pendingAudioHeader: Record<string, unknown> | null = null
  let pendingAudioBytes = 0

  function drain(): void {
    for (;;) {
      if (pendingAudioHeader) {
        if (buffer.length < pendingAudioBytes) {
          return
        }
        const payload = Buffer.from(buffer.subarray(0, pendingAudioBytes))
        buffer = buffer.subarray(pendingAudioBytes)
        const pcm = new Float32Array(
          payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
        )
        const header = pendingAudioHeader
        pendingAudioHeader = null
        pendingAudioBytes = 0
        if (
          typeof header.id === 'string' &&
          typeof header.seq === 'number' &&
          typeof header.sampleRate === 'number' &&
          typeof header.final === 'boolean'
        ) {
          onFrame({
            type: 'audio',
            id: header.id,
            seq: header.seq,
            sampleRate: header.sampleRate,
            final: header.final,
            pcm
          })
        }
        continue
      }
      const newlineIndex = buffer.indexOf(0x0a)
      if (newlineIndex === -1) {
        return
      }
      const line = buffer.subarray(0, newlineIndex).toString('utf8').trim()
      buffer = buffer.subarray(newlineIndex + 1)
      if (line.length === 0) {
        continue
      }
      let header: unknown
      try {
        header = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(header)) {
        continue
      }
      if (header.type === 'audio' && typeof header.bytes === 'number') {
        pendingAudioHeader = header
        pendingAudioBytes = header.bytes
        continue
      }
      const frame = decodeHeaderFrame(header)
      if (frame) {
        onFrame(frame)
      }
    }
  }

  return (chunk: Buffer) => {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk])
    drain()
  }
}
