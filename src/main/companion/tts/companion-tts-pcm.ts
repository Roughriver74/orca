// Yandex SpeechKit's raw PCM formats (v1 `lpcm`, v3 `LINEAR16_PCM`) are signed 16-bit
// little-endian mono — the same shape the companion panel's WebAudio playback never
// sees directly, since the rest of the pipeline (Silero sidecar, the playback contract)
// speaks Float32 in [-1, 1]. This is the one conversion point for that boundary.

const INT16_MAX_MAGNITUDE = 32768

/** Converts a buffer of signed 16-bit little-endian PCM samples to Float32 in [-1, 1].
 *  A trailing odd byte (a response cut mid-sample) is dropped, not read out of bounds. */
export function pcm16LEToFloat32(buffer: Buffer | Uint8Array): Float32Array {
  const sampleCount = Math.floor(buffer.byteLength / 2)
  const out = new Float32Array(sampleCount)
  const view =
    buffer instanceof Buffer
      ? buffer
      : Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  for (let i = 0; i < sampleCount; i++) {
    out[i] = view.readInt16LE(i * 2) / INT16_MAX_MAGNITUDE
  }
  return out
}
