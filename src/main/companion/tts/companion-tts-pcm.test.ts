import { describe, expect, it } from 'vitest'
import { pcm16LEToFloat32 } from './companion-tts-pcm'

describe('pcm16LEToFloat32', () => {
  it('converts full-scale and mid-range signed 16-bit samples to [-1, 1]', () => {
    const buffer = Buffer.alloc(8)
    buffer.writeInt16LE(32767, 0)
    buffer.writeInt16LE(-32768, 2)
    buffer.writeInt16LE(0, 4)
    buffer.writeInt16LE(16384, 6)

    const result = pcm16LEToFloat32(buffer)

    expect(result).toHaveLength(4)
    expect(result[0]).toBeCloseTo(32767 / 32768, 5)
    expect(result[1]).toBeCloseTo(-1, 5)
    expect(result[2]).toBe(0)
    expect(result[3]).toBeCloseTo(0.5, 3)
  })

  it('returns an empty array for an empty buffer', () => {
    expect(pcm16LEToFloat32(Buffer.alloc(0))).toHaveLength(0)
  })

  it('drops a trailing odd byte instead of reading out of bounds', () => {
    const buffer = Buffer.alloc(3)
    buffer.writeInt16LE(100, 0)
    buffer[2] = 0xff

    const result = pcm16LEToFloat32(buffer)

    expect(result).toHaveLength(1)
    expect(result[0]).toBeCloseTo(100 / 32768, 5)
  })

  it('accepts a Uint8Array view (not just a Buffer)', () => {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setInt16(0, -16384, true)
    new DataView(bytes.buffer).setInt16(2, 16384, true)

    const result = pcm16LEToFloat32(bytes)

    expect(result[0]).toBeCloseTo(-0.5, 3)
    expect(result[1]).toBeCloseTo(0.5, 3)
  })
})
