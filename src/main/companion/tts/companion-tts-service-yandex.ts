// The Yandex-provider halves of `speak()`/`speakStream()`, split out of
// companion-tts-service.ts to keep that file under the repo's per-file line cap. Takes
// every Silero/utterance-bookkeeping capability it needs as a dependency rather than
// being a method on CompanionTtsService itself, so this file has no `this` coupling.

import { randomUUID } from 'node:crypto'
import { sendTtsError } from '../companion-audio-output'
import { AsyncItemChannel } from './companion-tts-item-channel'
import { SentenceStreamChunker, splitIntoSentences } from './companion-tts-sentence-chunker'
import {
  CompanionTtsCancelledError,
  type CompanionTtsSidecarProcess,
  type CompanionTtsSynthesisChunk
} from './companion-tts-sidecar-process'
import { normalizeForSpeech } from './companion-tts-text-normalization'
import { packSentencesForYandex } from './companion-tts-yandex-chunking'
import { describeYandexErrorRu } from './companion-tts-yandex-errors'
import { YANDEX_V3_UNIT_MAX_CHARS } from './companion-tts-yandex-pricing'
import type { CompanionTtsYandexSpeaker } from './companion-tts-yandex-speaker'
import type {
  CompanionTtsProviderSettings,
  CompanionTtsSpeakOptions,
  CompanionTtsStreamHandle,
  SynthesisHandle,
  UtteranceHandle
} from './companion-tts-service'

export type CompanionTtsYandexBranchDeps = {
  beginUtterance: (utteranceId: string) => UtteranceHandle
  endUtterance: (utteranceId: string) => void
  drainAndSend: (channel: AsyncItemChannel<SynthesisHandle>, utteranceId: string) => Promise<void>
  getYandexSpeaker: () => CompanionTtsYandexSpeaker
  ensureSidecar: () => Promise<CompanionTtsSidecarProcess>
  synthesizeSentence: (
    sidecar: CompanionTtsSidecarProcess,
    sentence: string,
    options: CompanionTtsSpeakOptions,
    handle: UtteranceHandle
  ) => SynthesisHandle
}

export type CompanionTtsYandexBranch = {
  speakYandex: (
    text: string,
    options: CompanionTtsSpeakOptions,
    providerSettings: CompanionTtsProviderSettings
  ) => Promise<void>
  speakStreamYandex: (
    options: CompanionTtsSpeakOptions,
    providerSettings: CompanionTtsProviderSettings
  ) => CompanionTtsStreamHandle
}

export function createCompanionTtsYandexBranch(
  deps: CompanionTtsYandexBranchDeps
): CompanionTtsYandexBranch {
  /** Synthesizes one packed request chunk via Yandex; on any failure (auth/quota/network/
   *  server) falls back to the Silero sidecar for that one chunk using the already-
   *  configured Silero voice/rate, and if that also fails — or Silero was never
   *  provisioned — tells the panel why in Russian and skips the chunk (a
   *  cancellation-shaped skip: `drainAndSend` sends no audio for it and the rest of the
   *  utterance continues). Never lets a Yandex failure become an unhandled rejection or
   *  abort the whole reply. */
  async function synthesizeYandexChunk(
    text: string,
    options: CompanionTtsSpeakOptions,
    providerSettings: CompanionTtsProviderSettings,
    handle: UtteranceHandle
  ): Promise<CompanionTtsSynthesisChunk> {
    const requestId = `${options.utteranceId}:${randomUUID()}`
    handle.requestIds.add(requestId)
    try {
      const result = await deps
        .getYandexSpeaker()
        .synthesize(requestId, text, providerSettings.yandexVoice, options.rate)
      handle.requestIds.delete(requestId)
      return { requestId, seq: 0, final: true, sampleRate: result.sampleRate, pcm: result.pcm }
    } catch (error) {
      handle.requestIds.delete(requestId)
      if (error instanceof CompanionTtsCancelledError) {
        throw error
      }
      console.error('[companion-tts] Yandex synthesis failed', error)
      try {
        const sidecar = await deps.ensureSidecar()
        return await deps.synthesizeSentence(sidecar, text, options, handle)
      } catch {
        sendTtsError(describeYandexErrorRu(error))
        throw new CompanionTtsCancelledError(requestId)
      }
    }
  }

  /** Yandex equivalent of `speak()`: the whole reply is known upfront, so cap+pack happens once. */
  async function speakYandex(
    text: string,
    options: CompanionTtsSpeakOptions,
    providerSettings: CompanionTtsProviderSettings
  ): Promise<void> {
    const { sentences } = splitIntoSentences(normalizeForSpeech(text))
    const { requestChunks } = packSentencesForYandex(sentences, providerSettings.maxSpokenChars)
    const resultChannel = new AsyncItemChannel<SynthesisHandle>()
    const handle = deps.beginUtterance(options.utteranceId)
    for (const chunkText of requestChunks) {
      resultChannel.push(synthesizeYandexChunk(chunkText, options, providerSettings, handle))
    }
    resultChannel.finish()
    try {
      await deps.drainAndSend(resultChannel, options.utteranceId)
    } finally {
      deps.endUtterance(options.utteranceId)
    }
  }

  /** Yandex equivalent of `speakStream()`: packs sentences into ≤250-char request chunks
   *  as deltas complete them, stopping once `maxSpokenChars` worth of speech is queued —
   *  the brain keeps streaming text to the panel either way, only the voice stops early. */
  function speakStreamYandex(
    options: CompanionTtsSpeakOptions,
    providerSettings: CompanionTtsProviderSettings
  ): CompanionTtsStreamHandle {
    const chunker = new SentenceStreamChunker()
    const resultChannel = new AsyncItemChannel<SynthesisHandle>()
    const handle = deps.beginUtterance(options.utteranceId)
    const drainComplete = deps
      .drainAndSend(resultChannel, options.utteranceId)
      .finally(() => deps.endUtterance(options.utteranceId))

    let spokenChars = 0
    let capped = false
    let packBuffer: string[] = []
    let packBufferChars = 0

    const flushPack = (): void => {
      if (packBuffer.length === 0) {
        return
      }
      const chunkText = packBuffer.join(' ')
      packBuffer = []
      packBufferChars = 0
      resultChannel.push(synthesizeYandexChunk(chunkText, options, providerSettings, handle))
    }

    const acceptSentence = (sentence: string): void => {
      if (capped) {
        return
      }
      if (spokenChars > 0 && spokenChars + sentence.length > providerSettings.maxSpokenChars) {
        capped = true
        flushPack()
        return
      }
      spokenChars += sentence.length
      const joinedLength =
        packBufferChars === 0 ? sentence.length : packBufferChars + 1 + sentence.length
      if (packBufferChars > 0 && joinedLength > YANDEX_V3_UNIT_MAX_CHARS) {
        flushPack()
      }
      packBuffer.push(sentence)
      packBufferChars =
        packBuffer.length === 1 ? sentence.length : packBufferChars + 1 + sentence.length
    }

    return {
      pushDelta: (text: string) => {
        for (const sentence of chunker.push(text)) {
          acceptSentence(sentence)
        }
      },
      finish: () => {
        for (const sentence of chunker.flush()) {
          acceptSentence(sentence)
        }
        flushPack()
        resultChannel.finish()
        void drainComplete
      }
    }
  }

  return { speakYandex, speakStreamYandex }
}
