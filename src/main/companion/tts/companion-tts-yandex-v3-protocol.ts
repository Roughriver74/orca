// Parses the v3 `utteranceSynthesis` response: NDJSON, one `{"result":{"audioChunk":{"data":
// "<base64>"}}}` object per line. The HTTP transport hands this parser arbitrary-sized text
// chunks that can split a line (or the trailing newline) anywhere, so a line is only ever
// parsed once a `\n` completes it — a partial tail is held back for the next feed.

import { isRecord } from '../../../shared/agent-status-child-work-value-guards'

function extractAudioBase64(line: string): string | null {
  if (line.trim() === '') {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(parsed) || !isRecord(parsed.result) || !isRecord(parsed.result.audioChunk)) {
    return null
  }
  const data = parsed.result.audioChunk.data
  return typeof data === 'string' ? data : null
}

/** Feed decoded text chunks via the returned function; `onAudioBase64` fires once per
 *  complete NDJSON line that carries an audio chunk, in order. Call `flush()` once the
 *  response body ends to parse a final line with no trailing newline. */
export function createYandexV3NdjsonParser(onAudioBase64: (base64: string) => void): {
  feed: (chunk: string) => void
  flush: () => void
} {
  let buffer = ''

  const consumeLine = (line: string): void => {
    const base64 = extractAudioBase64(line)
    if (base64 !== null) {
      onAudioBase64(base64)
    }
  }

  return {
    feed: (chunk: string) => {
      buffer += chunk
      let newlineIndex = buffer.indexOf('\n')
      while (newlineIndex !== -1) {
        consumeLine(buffer.slice(0, newlineIndex))
        buffer = buffer.slice(newlineIndex + 1)
        newlineIndex = buffer.indexOf('\n')
      }
    },
    flush: () => {
      if (buffer.trim() !== '') {
        consumeLine(buffer)
      }
      buffer = ''
    }
  }
}
