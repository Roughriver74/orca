// Ties the companion TTS pieces into the two entry points callers use: `speak()` for a
// whole reply already in hand, `speakStream()` for the brain's incremental deltas. Both
// normalize text, split it into sentences, pipeline sentence synthesis one ahead of
// what has been sent so sentence N+1 synthesizes while N is already streaming to the
// panel, and push PCM chunks through the playback contract CompanionShell owns.
// Streamed sentences are normalized one at a time (with the user's pronunciation
// dictionary), so Latin words, markdown and digits never reach Silero raw.
//
// The Yandex and Qwen3 branches of each entry point live in companion-tts-service-yandex.ts
// and companion-tts-service-qwen3.ts (split out to stay under the repo's per-file line
// cap); `resolveEffectiveProvider()` below decides which branch a call takes.

import { randomUUID } from 'node:crypto'
import sidecarScriptPath from '../../../../resources/companion/tts-sidecar.py?asset&asarUnpack'
import type {
  CompanionTtsProvider,
  CompanionTtsSettings,
  CompanionTtsVoice
} from '../../../shared/companion-types'
import { stopAudio } from '../companion-audio-output'
import { AsyncItemChannel } from './companion-tts-item-channel'
import { getCompanionTtsPaths, readProvisionedModelPaths } from './companion-tts-provisioning'
import {
  SentenceStreamChunker,
  SpeechCodeFenceFilter,
  splitIntoSentences
} from './companion-tts-sentence-chunker'
import {
  loadUtterancePronunciations,
  synthesizeSpeakableText
} from './companion-tts-speakable-text'
import { sendSentenceResults } from './companion-tts-panel-send'
import {
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
import {
  createCompanionTtsQwen3Branch,
  type CompanionTtsQwen3Branch
} from './companion-tts-service-qwen3'
import { isCompanionTtsQwen3Provisioned } from './companion-tts-qwen3-provisioning'

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
  'provider' | 'yandexVoice' | 'maxSpokenChars' | 'yandexMonthlyBudgetRub' | 'qwenEmotion'
>

export type CompanionTtsQwen3Options = {
  sidecarFactory?: SidecarFactory
  /** Overridable for tests; the real check reads the provisioning marker file. */
  isProvisioned?: () => boolean
}

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
  private readonly isUtteranceActive = (utteranceId: string): boolean =>
    this.activeUtterances.has(utteranceId)
  private yandexSpeaker: CompanionTtsYandexSpeaker | null = null
  private readonly qwen3: CompanionTtsQwen3Branch
  private readonly isQwen3Provisioned: () => boolean
  private readonly yandexBranch: CompanionTtsYandexBranch = createCompanionTtsYandexBranch({
    beginUtterance: (utteranceId) => this.beginUtterance(utteranceId),
    endUtterance: (utteranceId) => this.activeUtterances.delete(utteranceId),
    drainAndSend: (channel, utteranceId) =>
      sendSentenceResults(channel, utteranceId, this.isUtteranceActive),
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
      new CompanionTtsYandexSpeaker(userDataDir),
    qwen3Options: CompanionTtsQwen3Options = {}
  ) {
    this.isQwen3Provisioned =
      qwen3Options.isProvisioned ?? (() => isCompanionTtsQwen3Provisioned(userDataDir))
    this.qwen3 = createCompanionTtsQwen3Branch({
      userDataDir,
      sidecarFactory: qwen3Options.sidecarFactory ?? sidecarFactory,
      beginUtterance: (utteranceId) => this.beginUtterance(utteranceId),
      endUtterance: (utteranceId) => this.activeUtterances.delete(utteranceId),
      isUtteranceActive: this.isUtteranceActive,
      ensureSileroSidecar: () => this.ensureSidecar(),
      synthesizeSileroSentence: (sidecar, sentence, options, handle) =>
        this.synthesizeSentence(sidecar, sentence, options, handle)
    })
  }

  private getYandexSpeaker(): CompanionTtsYandexSpeaker {
    this.yandexSpeaker ??= this.yandexSpeakerFactory()
    return this.yandexSpeaker
  }

  /** Yandex only when selected, a key is configured, and the 30-day spend estimate has
   *  not reached the budget; Qwen3 only when selected, provisioned and its sidecar is not
   *  cooling down after a failed start — any other case keeps using the local Silero
   *  sidecar. A Qwen3 sidecar left over from an earlier selection is stopped. */
  private resolveEffectiveProvider(settings: CompanionTtsProviderSettings): CompanionTtsProvider {
    if (settings.provider !== 'qwen3') {
      void this.qwen3.release()
    } else if (this.isQwen3Provisioned() && this.qwen3.isHealthy()) {
      return 'qwen3'
    }
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
      const { v5ModelPath, v3ModelPath, v56ModelPath } = await readProvisionedModelPaths(
        this.userDataDir
      )
      if (!v5ModelPath && !v3ModelPath && !v56ModelPath) {
        throw new Error('companion TTS has not been provisioned yet — enable it in settings first')
      }
      const sidecar = this.sidecarFactory({
        pythonPath: paths.venvPythonPath,
        scriptPath: sidecarScriptPath,
        scriptArgs: [v5ModelPath ?? '-', v3ModelPath ?? '-', v56ModelPath ?? '-']
      })
      this.sidecar = sidecar
      return sidecar
    })()
    return this.sidecarReady
  }

  /** Starts the Silero (or selected Qwen3) sidecar ahead of the first reply, so the
   *  cold start measured at 1.4-2s doesn't sit in that reply's time-to-first-audio. Called
   *  from companion-assets.ts on app start / settings change / once provisioning finishes.
   *  Skipped for the Yandex provider: Yandex replies don't need the Silero sidecar, and a
   *  Yandex setup that later falls back to Silero (budget/outage) is already too rare and
   *  too far from "first reply" for a preemptive spawn to be worth the memory. Swallows
   *  errors — provisioning may not have finished yet, in which case the real speak() call
   *  that follows will retry and surface them. */
  async prewarm(): Promise<void> {
    const settings = this.getProviderSettings()
    if (settings.provider === 'yandex') {
      return
    }
    try {
      if (this.resolveEffectiveProvider(settings) === 'qwen3') {
        await this.qwen3.prewarm()
        return
      }
      const sidecar = await this.ensureSidecar()
      await sidecar.warmUp()
    } catch (error) {
      console.error('[companion] TTS sidecar prewarm failed', error)
    }
  }

  /** Synthesizes and streams a complete reply, resolving once every sentence has been sent. */
  async speak(text: string, options: CompanionTtsSpeakOptions): Promise<void> {
    const providerSettings = this.getProviderSettings()
    const provider = this.resolveEffectiveProvider(providerSettings)
    if (provider === 'yandex') {
      return this.yandexBranch.speakYandex(text, options, providerSettings)
    }
    if (provider === 'qwen3') {
      return this.qwen3.speak(text, options, providerSettings.qwenEmotion)
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
      await sendSentenceResults(resultChannel, options.utteranceId, this.isUtteranceActive)
    } finally {
      this.activeUtterances.delete(options.utteranceId)
    }
  }

  /** Opens a streaming handle: call `pushDelta` as brain text arrives, `finish()` once the turn ends. */
  speakStream(options: CompanionTtsSpeakOptions): CompanionTtsStreamHandle {
    const providerSettings = this.getProviderSettings()
    const provider = this.resolveEffectiveProvider(providerSettings)
    if (provider === 'yandex') {
      return this.yandexBranch.speakStreamYandex(options, providerSettings)
    }
    if (provider === 'qwen3') {
      return this.qwen3.speakStream(options, providerSettings.qwenEmotion)
    }
    const chunker = new SentenceStreamChunker({ earlyClauseSplit: true })
    const fenceFilter = new SpeechCodeFenceFilter()
    const resultChannel = new AsyncItemChannel<SynthesisHandle>()
    const handle = this.beginUtterance(options.utteranceId)
    const sidecarPromise = this.ensureSidecar()
    const pronunciationsPromise = loadUtterancePronunciations(options.pronunciationsPath)
    const drainComplete = sidecarPromise
      .then(() => sendSentenceResults(resultChannel, options.utteranceId, this.isUtteranceActive))
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
        this.qwen3.cancel(requestId)
        this.yandexSpeaker?.cancel(requestId)
      }
      this.activeUtterances.delete(id)
    }
    stopAudio(utteranceId)
  }

  async shutdown(): Promise<void> {
    await Promise.all([this.sidecar?.shutdown(), this.qwen3.release()])
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
