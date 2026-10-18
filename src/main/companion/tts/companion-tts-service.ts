// Ties the companion TTS pieces into the two entry points callers use: `speak()` for a
// whole reply already in hand, `speakStream()` for the brain's incremental deltas. Both
// normalize text, split it into sentences, pipeline sentence synthesis one ahead of
// what has been sent so sentence N+1 synthesizes while N is already streaming to the
// panel, and push PCM chunks through the playback contract CompanionShell owns.
// Streamed sentences are normalized one at a time (with the user's pronunciation
// dictionary), so Latin words, markdown and digits never reach Silero raw.
//
// The Yandex-provider branch of each entry point lives in
// companion-tts-service-yandex.ts (split out to stay under the repo's per-file line
// cap); `resolveEffectiveProvider()` below decides which branch a call takes.

import { randomUUID } from 'node:crypto'
import sidecarScriptPath from '../../../../resources/companion/tts-sidecar.py?asset&asarUnpack'
import type { CompanionTtsSettings, CompanionTtsVoice } from '../../../shared/companion-types'
import { sendAudioChunk, stopAudio } from '../companion-audio-output'
import { AsyncItemChannel } from './companion-tts-item-channel'
import { getCompanionTtsPaths, readProvisionedModelPaths } from './companion-tts-provisioning'
import {
  SentenceStreamChunker,
  SpeechCodeFenceFilter,
  splitIntoSentences
} from './companion-tts-sentence-chunker'
import {
  SIDECAR_SAMPLE_RATE,
  closingSilencePcm,
  loadUtterancePronunciations,
  synthesizeSpeakableText
} from './companion-tts-speakable-text'
import {
  CompanionTtsCancelledError,
  CompanionTtsSidecarProcess,
  type CompanionTtsSidecarConfig,
  type CompanionTtsSynthesisChunk
} from './companion-tts-sidecar-process'
import { normalizeForSpeech } from './companion-tts-text-normalization'
import { getDefaultCompanionSettings } from '../../../shared/constants'
import { CompanionTtsYandexSpeaker } from './companion-tts-yandex-speaker'
import { isYandexTtsBudgetExceeded } from './companion-tts-usage'
import {
  createCompanionTtsYandexBranch,
  type CompanionTtsYandexBranch
} from './companion-tts-service-yandex'

export type CompanionTtsSpeakOptions = {
  utteranceId: string
  voice: CompanionTtsVoice
  rate: number
  /** User pronunciation dictionary file; absent = built-in Latin rules only. */
  pronunciationsPath?: string
}

export type SynthesisHandle = Promise<CompanionTtsSynthesisChunk>

export type UtteranceHandle = {
  requestIds: Set<string>
  cancelled: boolean
}

/** Streaming handle returned by `speakStream()`: feed brain deltas in, call `finish()` once the turn ends. */
export type CompanionTtsStreamHandle = {
  pushDelta(text: string): void
  finish(): void
}

type SidecarFactory = (config: CompanionTtsSidecarConfig) => CompanionTtsSidecarProcess

export type CompanionTtsProviderSettings = Pick<
  CompanionTtsSettings,
  'provider' | 'yandexVoice' | 'maxSpokenChars' | 'yandexMonthlyBudgetRub'
>

/** Read by `CompanionTtsService` on every `speak()`/`speakStream()` call so neither needs
 *  a settings param the existing `speak(text, { utteranceId, voice, rate })` callers (the
 *  dialogue orchestrator, `orca companion say`) do not pass. Wired once at startup via
 *  `setCompanionTtsProviderSettingsSource` (see register-core-handlers.ts); defaults to
 *  the Silero-only shipped defaults so a test or early-boot call never throws. */
let companionTtsProviderSettingsSource: () => CompanionTtsProviderSettings = () =>
  getDefaultCompanionSettings().tts

export function setCompanionTtsProviderSettingsSource(
  source: () => CompanionTtsProviderSettings
): void {
  companionTtsProviderSettingsSource = source
}

export class CompanionTtsService {
  private sidecar: CompanionTtsSidecarProcess | null = null
  private sidecarReady: Promise<CompanionTtsSidecarProcess> | null = null
  private readonly activeUtterances = new Map<string, UtteranceHandle>()
  private yandexSpeaker: CompanionTtsYandexSpeaker | null = null
  private readonly yandexBranch: CompanionTtsYandexBranch = createCompanionTtsYandexBranch({
    beginUtterance: (utteranceId) => this.beginUtterance(utteranceId),
    endUtterance: (utteranceId) => this.activeUtterances.delete(utteranceId),
    drainAndSend: (channel, utteranceId) => this.drainAndSend(channel, utteranceId),
    getYandexSpeaker: () => this.getYandexSpeaker(),
    ensureSidecar: () => this.ensureSidecar(),
    synthesizeSentence: (sidecar, sentence, options, handle) =>
      this.synthesizeSentence(sidecar, sentence, options, handle)
  })

  constructor(
    private readonly userDataDir: string,
    private readonly sidecarFactory: SidecarFactory = (config) =>
      new CompanionTtsSidecarProcess(config),
    private readonly getProviderSettings: () => CompanionTtsProviderSettings = () =>
      companionTtsProviderSettingsSource(),
    private readonly yandexSpeakerFactory: () => CompanionTtsYandexSpeaker = () =>
      new CompanionTtsYandexSpeaker(userDataDir)
  ) {}

  private getYandexSpeaker(): CompanionTtsYandexSpeaker {
    this.yandexSpeaker ??= this.yandexSpeakerFactory()
    return this.yandexSpeaker
  }

  /** Yandex only when selected, a key is configured, and the 30-day spend estimate has
   *  not reached the budget — any other case keeps using the local Silero sidecar. */
  private resolveEffectiveProvider(settings: CompanionTtsProviderSettings): 'silero' | 'yandex' {
    if (settings.provider !== 'yandex') {
      return 'silero'
    }
    if (!this.getYandexSpeaker().isAvailable()) {
      return 'silero'
    }
    if (isYandexTtsBudgetExceeded(this.userDataDir, settings.yandexMonthlyBudgetRub)) {
      return 'silero'
    }
    return 'yandex'
  }

  /** Resolves provisioned model paths and the venv interpreter, then builds the sidecar once. */
  private async ensureSidecar(): Promise<CompanionTtsSidecarProcess> {
    if (this.sidecar) {
      return this.sidecar
    }
    this.sidecarReady ??= (async () => {
      const paths = getCompanionTtsPaths(this.userDataDir)
      const { v5ModelPath, v3ModelPath } = await readProvisionedModelPaths(this.userDataDir)
      if (!v5ModelPath && !v3ModelPath) {
        throw new Error('companion TTS has not been provisioned yet — enable it in settings first')
      }
      const sidecar = this.sidecarFactory({
        pythonPath: paths.venvPythonPath,
        scriptPath: sidecarScriptPath,
        v5ModelPath,
        v3ModelPath
      })
      this.sidecar = sidecar
      return sidecar
    })()
    return this.sidecarReady
  }

  /** Synthesizes and streams a complete reply, resolving once every sentence has been sent. */
  async speak(text: string, options: CompanionTtsSpeakOptions): Promise<void> {
    const providerSettings = this.getProviderSettings()
    if (this.resolveEffectiveProvider(providerSettings) === 'yandex') {
      return this.yandexBranch.speakYandex(text, options, providerSettings)
    }
    const sidecar = await this.ensureSidecar()
    const pronunciations = await loadUtterancePronunciations(options.pronunciationsPath)
    const { sentences } = splitIntoSentences(normalizeForSpeech(text, { pronunciations }))
    const resultChannel = new AsyncItemChannel<SynthesisHandle>()
    const handle = this.beginUtterance(options.utteranceId)
    for (const sentence of sentences) {
      resultChannel.push(this.synthesizeSentence(sidecar, sentence, options, handle))
    }
    resultChannel.finish()
    try {
      await this.drainAndSend(resultChannel, options.utteranceId)
    } finally {
      this.activeUtterances.delete(options.utteranceId)
    }
  }

  /** Opens a streaming handle: call `pushDelta` as brain text arrives, `finish()` once the turn ends. */
  speakStream(options: CompanionTtsSpeakOptions): CompanionTtsStreamHandle {
    const providerSettings = this.getProviderSettings()
    if (this.resolveEffectiveProvider(providerSettings) === 'yandex') {
      return this.yandexBranch.speakStreamYandex(options, providerSettings)
    }
    const chunker = new SentenceStreamChunker()
    const fenceFilter = new SpeechCodeFenceFilter()
    const resultChannel = new AsyncItemChannel<SynthesisHandle>()
    const handle = this.beginUtterance(options.utteranceId)
    const sidecarPromise = this.ensureSidecar()
    const pronunciationsPromise = loadUtterancePronunciations(options.pronunciationsPath)
    const drainComplete = sidecarPromise
      .then(() => this.drainAndSend(resultChannel, options.utteranceId))
      .finally(() => this.activeUtterances.delete(options.utteranceId))

    const enqueue = (sentence: string): void => {
      const prose = fenceFilter.filter(sentence)
      if (prose.trim() === '') {
        return
      }
      resultChannel.push(
        Promise.all([sidecarPromise, pronunciationsPromise]).then(([sidecar, pronunciations]) =>
          synthesizeSpeakableText(
            normalizeForSpeech(prose, { pronunciations }),
            (part) => this.synthesizeSentence(sidecar, part, options, handle),
            `${options.utteranceId}:nothing-to-say`
          )
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
        resultChannel.finish()
        void drainComplete
      }
    }
  }

  /** Cancels every outstanding sentence for an utterance (or every live utterance) and stops playback. */
  stop(utteranceId?: string): void {
    const ids = utteranceId ? [utteranceId] : Array.from(this.activeUtterances.keys())
    for (const id of ids) {
      const handle = this.activeUtterances.get(id)
      if (!handle) {
        continue
      }
      handle.cancelled = true
      for (const requestId of handle.requestIds) {
        this.sidecar?.cancel(requestId)
        this.yandexSpeaker?.cancel(requestId)
      }
      this.activeUtterances.delete(id)
    }
    stopAudio(utteranceId)
  }

  async shutdown(): Promise<void> {
    await this.sidecar?.shutdown()
  }

  private beginUtterance(utteranceId: string): UtteranceHandle {
    const handle: UtteranceHandle = { requestIds: new Set(), cancelled: false }
    this.activeUtterances.set(utteranceId, handle)
    return handle
  }

  private synthesizeSentence(
    sidecar: CompanionTtsSidecarProcess,
    sentence: string,
    options: CompanionTtsSpeakOptions,
    handle: UtteranceHandle
  ): SynthesisHandle {
    const requestId = `${options.utteranceId}:${randomUUID()}`
    handle.requestIds.add(requestId)
    // The sidecar sends exactly one audio frame per request (resources/companion/tts-sidecar.py
    // always calls send_audio once), so capturing it in this closure and resolving once
    // `synthesize()`'s promise settles on `done` is exact, not an approximation.
    let captured: CompanionTtsSynthesisChunk | null = null
    return sidecar
      .synthesize(requestId, sentence, options.voice, options.rate, (chunk) => {
        captured = chunk
      })
      .then(() => {
        handle.requestIds.delete(requestId)
        if (!captured) {
          throw new Error(`companion TTS request ${requestId} completed without an audio chunk`)
        }
        return captured
      })
  }

  private async drainAndSend(
    channel: AsyncItemChannel<SynthesisHandle>,
    utteranceId: string
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
    if (seq > 0 && !sentFinal && this.activeUtterances.has(utteranceId)) {
      sendAudioChunk({
        utteranceId,
        seq,
        sampleRate: lastSampleRate,
        pcm: closingSilencePcm(),
        final: true
      })
    }
  }
}

let companionTtsService: CompanionTtsService | null = null

export function getCompanionTtsService(userDataDir: string): CompanionTtsService {
  companionTtsService ??= new CompanionTtsService(userDataDir)
  return companionTtsService
}

export async function resetCompanionTtsServiceForTests(): Promise<void> {
  if (companionTtsService) {
    await companionTtsService.shutdown()
  }
  companionTtsService = null
}
