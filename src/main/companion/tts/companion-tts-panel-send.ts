// Sends synthesized speech to the panel in utterance order. Two shapes: one PCM chunk per
// sentence (Silero, Yandex — `final` rides on the last sentence) and a chunk stream per
// sentence (Qwen3 — the end is only known once the last stream ends, so a short silence
// carries `final`). Either way the panel only reports 'ended' after a `final` chunk.

import { sendAudioChunk } from '../companion-audio-output'
import type { AsyncItemChannel } from './companion-tts-item-channel'
import type { SynthesisHandle, UtteranceHandle } from './companion-tts-service'
import {
  CompanionTtsCancelledError,
  type CompanionTtsSynthesisChunk
} from './companion-tts-sidecar-process'
import { SIDECAR_SAMPLE_RATE, closingSilencePcm } from './companion-tts-speakable-text'

export type SentenceAudioStream = AsyncItemChannel<CompanionTtsSynthesisChunk>

/** One chunk per sentence; a cancelled/skipped sentence sends nothing. */
export async function sendSentenceResults(
  channel: AsyncItemChannel<SynthesisHandle>,
  utteranceId: string,
  isUtteranceActive: (utteranceId: string) => boolean
): Promise<void> {
  let seq = 0
  let sentFinal = false
  let lastSampleRate = SIDECAR_SAMPLE_RATE
  let box = await channel.next()
  while (box !== null) {
    let result: CompanionTtsSynthesisChunk | null = null
    try {
      result = await box.value
    } catch (error) {
      if (!(error instanceof CompanionTtsCancelledError)) {
        throw error
      }
    }
    const nextBox = await channel.next()
    if (result) {
      sentFinal = nextBox === null
      lastSampleRate = result.sampleRate
      sendAudioChunk({
        utteranceId,
        seq: seq++,
        sampleRate: result.sampleRate,
        pcm: result.pcm,
        final: sentFinal
      })
    }
    box = nextBox
  }
  // Close an utterance whose last sentence was skipped. Not when nothing played at all
  // (that stays silent), nor after `stop()` dropped it (it must not start playing again).
  if (seq > 0 && !sentFinal && isUtteranceActive(utteranceId)) {
    sendAudioChunk({
      utteranceId,
      seq,
      sampleRate: lastSampleRate,
      pcm: closingSilencePcm(),
      final: true
    })
  }
}

/** Every chunk goes out as it arrives; nothing more is sent once the utterance is stopped. */
export async function sendStreamedSentences(
  channel: AsyncItemChannel<SentenceAudioStream>,
  utteranceId: string,
  handle: UtteranceHandle,
  isUtteranceActive: (utteranceId: string) => boolean
): Promise<void> {
  let seq = 0
  let lastSampleRate = SIDECAR_SAMPLE_RATE
  for (let sentence = await channel.next(); sentence; sentence = await channel.next()) {
    for (let chunk = await sentence.value.next(); chunk; chunk = await sentence.value.next()) {
      if (handle.cancelled) {
        continue
      }
      lastSampleRate = chunk.value.sampleRate
      sendAudioChunk({
        utteranceId,
        seq: seq++,
        sampleRate: chunk.value.sampleRate,
        pcm: chunk.value.pcm,
        final: false
      })
    }
  }
  if (seq > 0 && !handle.cancelled && isUtteranceActive(utteranceId)) {
    sendAudioChunk({
      utteranceId,
      seq,
      sampleRate: lastSampleRate,
      pcm: closingSilencePcm(),
      final: true
    })
  }
}
