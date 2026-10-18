// Cost-aware packing for Yandex requests: v3 bills per request unit of up to 250
// characters, so packing several short sentences into one request can turn N billed
// units into 1. Two independent caps apply, in order:
//
//  1. `maxSpokenChars` (settings, economy knob): once the running total of *accepted*
//     sentence text would exceed it, later sentences are not spoken at all — the full
//     reply still renders in the panel as text, only the voice stops early. The very
//     first sentence is always accepted even if it alone exceeds the cap (speaking
//     nothing would be worse than speaking one sentence over budget).
//  2. `YANDEX_V3_UNIT_MAX_CHARS` (API limit), applied by greedily packing consecutive
//     accepted sentences into chunks — a chunk is flushed, and a new one started, only
//     once the next sentence would push it over the limit.
//
// v1 bills per character regardless of request shape, so packing does not change its
// cost — callers needing v1 can pass `unitMaxChars = Infinity` to keep each accepted
// sentence as its own request (no latency cost from waiting to pack).

import { YANDEX_V3_UNIT_MAX_CHARS } from './companion-tts-yandex-pricing'

export type PackedYandexSpeech = {
  /** Requests to send, each within `unitMaxChars`, in speaking order. */
  requestChunks: string[]
  /** Total characters actually accepted for speech (before packing joins them). */
  spokenChars: number
  /** True when one or more trailing sentences were dropped by `maxSpokenChars`. */
  truncated: boolean
}

export function packSentencesForYandex(
  sentences: readonly string[],
  maxSpokenChars: number,
  unitMaxChars: number = YANDEX_V3_UNIT_MAX_CHARS
): PackedYandexSpeech {
  const accepted: string[] = []
  let spokenChars = 0
  let truncated = false
  for (const sentence of sentences) {
    if (spokenChars > 0 && spokenChars + sentence.length > maxSpokenChars) {
      truncated = true
      break
    }
    accepted.push(sentence)
    spokenChars += sentence.length
  }
  if (accepted.length < sentences.length && !truncated) {
    truncated = true
  }

  const requestChunks: string[] = []
  let buffer: string[] = []
  let bufferChars = 0
  const flush = (): void => {
    if (buffer.length > 0) {
      requestChunks.push(buffer.join(' '))
      buffer = []
      bufferChars = 0
    }
  }
  for (const sentence of accepted) {
    const joinedLength = bufferChars === 0 ? sentence.length : bufferChars + 1 + sentence.length
    if (bufferChars > 0 && joinedLength > unitMaxChars) {
      flush()
    }
    buffer.push(sentence)
    bufferChars = buffer.length === 1 ? sentence.length : bufferChars + 1 + sentence.length
  }
  flush()

  return { requestChunks, spokenChars, truncated }
}
