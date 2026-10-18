// Silero-path helpers for streamed sentences that went through `normalizeForSpeech`
// (Latin transliteration, number expansion): the text can come out empty (only code or a
// table) or longer than one sidecar call allows, yet each sentence must stay exactly one
// item in the service's synthesis channel.

import {
  CompanionTtsCancelledError,
  type CompanionTtsSynthesisChunk
} from './companion-tts-sidecar-process'
import { splitLongSentence } from './companion-tts-sentence-chunker'
import {
  EMPTY_PRONUNCIATION_DICTIONARY,
  type CompanionPronunciationDictionary
} from './companion-tts-latin-transliteration'
import { loadCompanionPronunciationDictionary } from './companion-tts-pronunciation-dictionary'

// Matches `SAMPLE_RATE` in resources/companion/tts-sidecar.py.
export const SIDECAR_SAMPLE_RATE = 48_000
const CLOSING_SILENCE_SAMPLES = 480

/** The user's dictionary for one utterance, or built-in rules only when there is no file. */
export function loadUtterancePronunciations(
  path: string | undefined
): Promise<CompanionPronunciationDictionary> {
  return path
    ? loadCompanionPronunciationDictionary(path)
    : Promise.resolve(EMPTY_PRONUNCIATION_DICTIONARY)
}

/**
 * Synthesizes normalized text as one chunk: re-split past the sidecar's per-call cap and
 * joined back together. Nothing speakable becomes the cancellation-shaped skip
 * `drainAndSend` already ignores.
 */
export async function synthesizeSpeakableText(
  text: string,
  synthesizePart: (part: string) => Promise<CompanionTtsSynthesisChunk>,
  skipId: string
): Promise<CompanionTtsSynthesisChunk> {
  const parts = text.trim() === '' ? [] : splitLongSentence(text)
  const [first, ...rest] = parts
  if (first === undefined) {
    throw new CompanionTtsCancelledError(skipId)
  }
  if (rest.length === 0) {
    return synthesizePart(first)
  }
  const chunks: CompanionTtsSynthesisChunk[] = []
  for (const part of parts) {
    chunks.push(await synthesizePart(part))
  }
  const pcm = new Float32Array(chunks.reduce((total, chunk) => total + chunk.pcm.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk.pcm, offset)
    offset += chunk.pcm.length
  }
  return { ...chunks[0], pcm }
}

/** The panel only reports 'ended' after a `final` chunk; when the last sentence had
 *  nothing to say, a short silence closes the utterance instead. */
export function closingSilencePcm(): Float32Array {
  return new Float32Array(CLOSING_SILENCE_SAMPLES)
}
