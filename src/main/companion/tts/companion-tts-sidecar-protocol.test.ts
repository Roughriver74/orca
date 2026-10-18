import { describe, expect, it } from 'vitest'
import {
  createCompanionTtsSidecarFrameReader,
  type CompanionTtsSidecarFrame
} from './companion-tts-sidecar-protocol'

function headerLine(header: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')
}

function pcmBuffer(samples: number[]): Buffer {
  const floats = new Float32Array(samples)
  return Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength)
}

describe('createCompanionTtsSidecarFrameReader', () => {
  it('decodes a ready frame', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    feed(headerLine({ type: 'ready' }))
    expect(frames).toEqual([{ type: 'ready' }])
  })

  it('decodes an audio frame with its exact trailing PCM payload', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    const pcm = pcmBuffer([0.1, -0.2, 0.3])
    feed(
      headerLine({
        type: 'audio',
        id: 'r1',
        seq: 0,
        sampleRate: 48000,
        final: true,
        bytes: pcm.length
      })
    )
    feed(pcm)
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame.type).toBe('audio')
    if (frame.type === 'audio') {
      expect(frame.id).toBe('r1')
      expect(Array.from(frame.pcm)).toEqual([Math.fround(0.1), Math.fround(-0.2), Math.fround(0.3)])
    }
  })

  it('reassembles a frame split across multiple chunk boundaries, including mid-payload', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    const pcm = pcmBuffer([1, 2, 3, 4])
    const header = headerLine({
      type: 'audio',
      id: 'r2',
      seq: 1,
      sampleRate: 24000,
      final: false,
      bytes: pcm.length
    })
    const whole = Buffer.concat([header, pcm, headerLine({ type: 'done', id: 'r2' })])
    for (let i = 0; i < whole.length; i += 5) {
      feed(whole.subarray(i, i + 5))
    }
    expect(frames.map((f) => f.type)).toEqual(['audio', 'done'])
  })

  it('decodes done and error frames, including a null id', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    feed(headerLine({ type: 'done', id: 'abc' }))
    feed(headerLine({ type: 'error', id: 'abc', message: 'boom' }))
    feed(headerLine({ type: 'error', id: null, message: 'model missing' }))
    expect(frames).toEqual([
      { type: 'done', id: 'abc' },
      { type: 'error', id: 'abc', message: 'boom' },
      { type: 'error', id: null, message: 'model missing' }
    ])
  })

  it('skips malformed JSON lines without losing sync on the next frame', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    feed(Buffer.from('not json at all\n', 'utf8'))
    feed(headerLine({ type: 'ready' }))
    expect(frames).toEqual([{ type: 'ready' }])
  })

  it('processes multiple requests interleaved across one chunk', () => {
    const frames: CompanionTtsSidecarFrame[] = []
    const feed = createCompanionTtsSidecarFrameReader((f) => frames.push(f))
    const pcmA = pcmBuffer([1])
    const pcmB = pcmBuffer([2, 3])
    feed(
      Buffer.concat([
        headerLine({
          type: 'audio',
          id: 'a',
          seq: 0,
          sampleRate: 48000,
          final: true,
          bytes: pcmA.length
        }),
        pcmA,
        headerLine({ type: 'done', id: 'a' }),
        headerLine({
          type: 'audio',
          id: 'b',
          seq: 0,
          sampleRate: 48000,
          final: true,
          bytes: pcmB.length
        }),
        pcmB,
        headerLine({ type: 'done', id: 'b' })
      ])
    )
    expect(frames.map((f) => (f.type === 'audio' ? `audio:${f.id}` : f.type))).toEqual([
      'audio:a',
      'done',
      'audio:b',
      'done'
    ])
  })
})
