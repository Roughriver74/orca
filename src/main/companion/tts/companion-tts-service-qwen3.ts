// The Qwen3-TTS halves of `speak()`/`speakStream()` plus the Qwen3 sidecar's lifecycle,
// split out of companion-tts-service.ts (per-file line cap). Unlike Silero, the Qwen3
// sidecar streams ~0.5s PCM chunks inside a sentence, so each sentence here is its own
// chunk channel and every chunk goes to the panel as soon as it arrives; the utterance
// is closed with a short final silence. Any Qwen3 failure falls back to the Silero
// sidecar for that sentence, and a sidecar that cannot start is skipped for a while.

import { randomUUID } from 'node:crypto'
import qwen3SidecarScriptPath from '../../../../resources/companion/tts-qwen3-sidecar.py?asset&asarUnpack'
import type { CompanionQwenEmotion } from '../../../shared/companion-types'
import { AsyncItemChannel } from './companion-tts-item-channel'
import { getCompanionTtsQwen3Paths } from './companion-tts-qwen3-provisioning'
import { prepareQwen3SpeechText } from './companion-tts-qwen3-text'
import {
  SentenceStreamChunker,
  SpeechCodeFenceFilter,
  splitIntoSentences
} from './companion-tts-sentence-chunker'
import {
  CompanionTtsCancelledError,
  type CompanionTtsSidecarConfig,
  type CompanionTtsSidecarProcess
} from './companion-tts-sidecar-process'
import { loadUtterancePronunciations } from './companion-tts-speakable-text'
import { sendStreamedSentences, type SentenceAudioStream } from './companion-tts-panel-send'
import { normalizeForSpeech } from './companion-tts-text-normalization'
import type {
  CompanionTtsSpeakOptions,
  CompanionTtsStreamHandle,
  SynthesisHandle,
  UtteranceHandle
} from './companion-tts-service'

const QWEN3_SPEAKER = 'ryan'
// After a sidecar that failed to start, speak with Silero for this long before retrying.
const START_FAILURE_COOLDOWN_MS = 10 * 60_000

/** CustomVoice `instruct` per emotion; neutral sends none so the model reads the text as-is. */
export const QWEN3_EMOTION_INSTRUCT: Record<CompanionQwenEmotion, string | undefined> = {
  neutral: undefined,
  warm: 'Speak warmly and kindly, with a gentle smile in the voice, friendly and caring.',
  mentor:
    'Speak as a mature, experienced mentor: calm, unhurried, confident and reassuring, with a steady, slightly lower voice.'
}

export type CompanionTtsQwen3BranchDeps = {
  userDataDir: string
  sidecarFactory: (config: CompanionTtsSidecarConfig) => CompanionTtsSidecarProcess
  beginUtterance: (utteranceId: string) => UtteranceHandle
  endUtterance: (utteranceId: string) => void
  isUtteranceActive: (utteranceId: string) => boolean
  ensureSileroSidecar: () => Promise<CompanionTtsSidecarProcess>
  synthesizeSileroSentence: (
    sidecar: CompanionTtsSidecarProcess,
    sentence: string,
    options: CompanionTtsSpeakOptions,
    handle: UtteranceHandle
  ) => SynthesisHandle
  now?: () => number
}

export type CompanionTtsQwen3Branch = {
  /** False while a start failure is cooling down — the caller then speaks with Silero. */
  isHealthy: () => boolean
  prewarm: () => Promise<void>
  speak: (
    text: string,
    options: CompanionTtsSpeakOptions,
    emotion: CompanionQwenEmotion
  ) => Promise<void>
  speakStream: (
    options: CompanionTtsSpeakOptions,
    emotion: CompanionQwenEmotion
  ) => CompanionTtsStreamHandle
  cancel: (requestId: string) => void
  /** Stops the sidecar (frees ~4 GB) once another provider is selected. */
  release: () => Promise<void>
}

export function createCompanionTtsQwen3Branch(
  deps: CompanionTtsQwen3BranchDeps
): CompanionTtsQwen3Branch {
  const now = deps.now ?? Date.now
  let sidecar: CompanionTtsSidecarProcess | null = null
  let startFailedAt: number | null = null

  const isHealthy = (): boolean =>
    startFailedAt === null || now() - startFailedAt >= START_FAILURE_COOLDOWN_MS

  async function ensureQwenSidecar(): Promise<CompanionTtsSidecarProcess> {
    if (!sidecar) {
      const paths = getCompanionTtsQwen3Paths(deps.userDataDir)
      sidecar = deps.sidecarFactory({
        pythonPath: paths.venvPythonPath,
        scriptPath: qwen3SidecarScriptPath,
        scriptArgs: [paths.modelDir]
      })
    }
    const current = sidecar
    try {
      await current.warmUp()
      startFailedAt = null
      return current
    } catch (error) {
      startFailedAt = now()
      sidecar = null
      void current.shutdown()
      throw error
    }
  }

  /** Streams one normalized sentence into `chunks` and finishes it; falls back to Silero
   *  when Qwen3 fails before producing audio. Cancellation just finishes the channel. */
  function synthesizeSentenceInto(
    chunks: SentenceAudioStream,
    sentence: string,
    options: CompanionTtsSpeakOptions,
    handle: UtteranceHandle,
    instruct: string | undefined
  ): void {
    const text = prepareQwen3SpeechText(sentence)
    if (text.trim() === '' || handle.cancelled) {
      chunks.finish()
      return
    }
    const requestId = `${options.utteranceId}:${randomUUID()}`
    handle.requestIds.add(requestId)
    let produced = 0
    const viaQwen = isHealthy()
      ? ensureQwenSidecar().then((qwen) =>
          qwen.synthesize(
            requestId,
            text,
            QWEN3_SPEAKER,
            options.rate,
            (chunk) => {
              produced += 1
              chunks.push(chunk)
            },
            instruct
          )
        )
      : Promise.reject(new Error('Qwen3 sidecar is cooling down after a start failure'))
    void viaQwen
      .catch(async (error: unknown) => {
        if (error instanceof CompanionTtsCancelledError || handle.cancelled || produced > 0) {
          return
        }
        console.warn('[companion-tts] Qwen3 synthesis failed, speaking with Silero', error)
        try {
          const silero = await deps.ensureSileroSidecar()
          chunks.push(await deps.synthesizeSileroSentence(silero, sentence, options, handle))
        } catch (sileroError) {
          if (!(sileroError instanceof CompanionTtsCancelledError)) {
            console.error('[companion-tts] Silero fallback failed too', sileroError)
          }
        }
      })
      .finally(() => {
        handle.requestIds.delete(requestId)
        chunks.finish()
      })
  }

  async function speak(
    text: string,
    options: CompanionTtsSpeakOptions,
    emotion: CompanionQwenEmotion
  ): Promise<void> {
    const pronunciations = await loadUtterancePronunciations(options.pronunciationsPath)
    const { sentences } = splitIntoSentences(normalizeForSpeech(text, { pronunciations }))
    const channel = new AsyncItemChannel<SentenceAudioStream>()
    const handle = deps.beginUtterance(options.utteranceId)
    for (const sentence of sentences) {
      const chunks: SentenceAudioStream = new AsyncItemChannel()
      channel.push(chunks)
      synthesizeSentenceInto(chunks, sentence, options, handle, QWEN3_EMOTION_INSTRUCT[emotion])
    }
    channel.finish()
    try {
      await sendStreamedSentences(channel, options.utteranceId, handle, deps.isUtteranceActive)
    } finally {
      deps.endUtterance(options.utteranceId)
    }
  }

  function speakStream(
    options: CompanionTtsSpeakOptions,
    emotion: CompanionQwenEmotion
  ): CompanionTtsStreamHandle {
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const fenceFilter = new SpeechCodeFenceFilter()
    const channel = new AsyncItemChannel<SentenceAudioStream>()
    const handle = deps.beginUtterance(options.utteranceId)
    const pronunciationsPromise = loadUtterancePronunciations(options.pronunciationsPath)
    const drainComplete = sendStreamedSentences(
      channel,
      options.utteranceId,
      handle,
      deps.isUtteranceActive
    ).finally(() => deps.endUtterance(options.utteranceId))
    // The slot is queued now so order holds while the dictionary is still loading; callbacks
    // on one promise run in registration order, so requests reach the sidecar in order too.
    const enqueue = (sentence: string): void => {
      const prose = fenceFilter.filter(sentence)
      if (prose.trim() === '') {
        return
      }
      const chunks: SentenceAudioStream = new AsyncItemChannel()
      channel.push(chunks)
      void pronunciationsPromise.then((pronunciations) =>
        synthesizeSentenceInto(
          chunks,
          normalizeForSpeech(prose, { pronunciations }),
          options,
          handle,
          QWEN3_EMOTION_INSTRUCT[emotion]
        )
      )
    }
    return {
      pushDelta: (text: string) => {
        for (const sentence of chunker.push(text)) {
          enqueue(sentence)
        }
      },
      finish: () => {
        for (const sentence of chunker.flush()) {
          enqueue(sentence)
        }
        channel.finish()
        void drainComplete
      }
    }
  }

  return {
    isHealthy,
    prewarm: async () => {
      if (isHealthy()) {
        await ensureQwenSidecar()
      }
    },
    speak,
    speakStream,
    cancel: (requestId) => sidecar?.cancel(requestId),
    release: async () => {
      const current = sidecar
      sidecar = null
      await current?.shutdown()
    }
  }
}
