// Disk cache for synthesized Yandex audio, keyed by exactly what determines the audio
// (voice, speed, text): repeated phrases — greetings, "секунду, смотрю", the fixed error
// line, agent-notice lines — cost nothing after the first synthesis. An LRU over a byte
// budget (not an entry count) because PCM entries vary a lot in size with text length.
//
// Each entry is one file: a small JSON header line, a newline, then raw little-endian
// Float32 PCM — avoids a second index roundtrip to learn an entry's sample rate, and
// avoids a separate metadata-only file per entry doubling the directory's file count.

import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '../../../shared/agent-status-child-work-value-guards'

export type CompanionTtsCacheEntry = {
  sampleRate: number
  pcm: Float32Array
}

export type CompanionTtsCacheKeyParts = {
  voice: string
  api: 'v1' | 'v3'
  rate: number
  text: string
}

export function companionTtsCacheKey(parts: CompanionTtsCacheKeyParts): string {
  return createHash('sha256')
    .update(`${parts.voice}|${parts.api}|${parts.rate}|${parts.text}`)
    .digest('hex')
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const HEADER_TERMINATOR = '\n'

export class CompanionTtsYandexCache {
  constructor(
    private readonly cacheDir: string,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES
  ) {}

  private pathFor(key: string): string {
    return join(this.cacheDir, `${key}.cache`)
  }

  async get(key: string): Promise<CompanionTtsCacheEntry | null> {
    const path = this.pathFor(key)
    let raw: Buffer
    try {
      raw = await readFile(path)
    } catch {
      return null
    }
    const headerEnd = raw.indexOf(HEADER_TERMINATOR)
    if (headerEnd === -1) {
      return null
    }
    let parsedHeader: unknown
    try {
      parsedHeader = JSON.parse(raw.subarray(0, headerEnd).toString('utf8'))
    } catch {
      return null
    }
    if (!isRecord(parsedHeader) || typeof parsedHeader.sampleRate !== 'number') {
      return null
    }
    const header = { sampleRate: parsedHeader.sampleRate }
    // `raw.subarray()`'s byteOffset is wherever the header ended, almost never a
    // multiple of 4 — Float32Array requires 4-byte alignment, so the PCM bytes are
    // copied into a fresh, aligned buffer rather than viewed in place.
    const pcmBytes = Buffer.from(raw.subarray(headerEnd + 1))
    const pcm = new Float32Array(
      pcmBytes.buffer,
      pcmBytes.byteOffset,
      Math.floor(pcmBytes.byteLength / Float32Array.BYTES_PER_ELEMENT)
    )
    // Touch mtime so the LRU eviction below sees this entry as freshly used.
    await open(path, 'r+').then(
      (handle) => handle.utimes(new Date(), new Date()).finally(() => handle.close()),
      () => {}
    )
    return { sampleRate: header.sampleRate, pcm }
  }

  async put(key: string, entry: CompanionTtsCacheEntry): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true })
    const header = Buffer.from(`${JSON.stringify({ sampleRate: entry.sampleRate })}\n`, 'utf8')
    const pcmBuffer = Buffer.from(entry.pcm.buffer, entry.pcm.byteOffset, entry.pcm.byteLength)
    const path = this.pathFor(key)
    const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`
    const handle = await open(tempPath, 'w')
    try {
      await handle.write(header)
      await handle.write(pcmBuffer)
    } finally {
      await handle.close()
    }
    await rename(tempPath, path)
    await this.evictOverBudget()
  }

  /** Removes least-recently-used (`mtime`) entries until the directory is back under the
   *  byte budget — called after every write since that is the only time the total grows. */
  private async evictOverBudget(): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.cacheDir)
    } catch {
      return
    }
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.cache'))
        .map(async (name) => {
          const path = join(this.cacheDir, name)
          const info = await stat(path)
          return { path, bytes: info.size, mtimeMs: info.mtimeMs }
        })
    )
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    if (total <= this.maxBytes) {
      return
    }
    const oldestFirst = entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of oldestFirst) {
      if (total <= this.maxBytes) {
        break
      }
      await rm(entry.path, { force: true })
      total -= entry.bytes
    }
  }
}
