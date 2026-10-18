// Composes the Yandex pieces (HTTP provider, disk cache, usage/cost accounting) behind
// one call the TTS service makes per packed request chunk: check cache, synthesize on a
// miss, record cost either way. Kept separate from CompanionTtsService so that file's
// Silero-specific plumbing (sidecar process, provisioning) stays untouched by this seam.

import { join } from 'node:path'
import { YANDEX_VOICE_MIN_API, type CompanionYandexVoice } from '../../../shared/companion-types'
import {
  hasYandexSpeechKitApiKey,
  readYandexSpeechKitApiKey
} from './companion-tts-yandex-key-store'
import { CompanionTtsYandexProvider } from './companion-tts-yandex-provider'
import { CompanionTtsYandexCache, companionTtsCacheKey } from './companion-tts-yandex-cache'
import { recordYandexTtsUsage } from './companion-tts-usage'
import { yandexV1CostRub, yandexV3CostRub } from './companion-tts-yandex-pricing'

export type CompanionTtsYandexSynthesisChunk = {
  sampleRate: number
  pcm: Float32Array
}

function costForChars(api: 'v1' | 'v3', characters: number): number {
  return api === 'v1' ? yandexV1CostRub(characters) : yandexV3CostRub(characters)
}

export class CompanionTtsYandexSpeaker {
  private readonly provider: CompanionTtsYandexProvider
  private readonly cache: CompanionTtsYandexCache

  constructor(
    private readonly userDataDir: string,
    deps: { provider?: CompanionTtsYandexProvider; cache?: CompanionTtsYandexCache } = {}
  ) {
    this.provider = deps.provider ?? new CompanionTtsYandexProvider(readYandexSpeechKitApiKey)
    this.cache =
      deps.cache ?? new CompanionTtsYandexCache(join(userDataDir, 'companion-tts-yandex-cache'))
  }

  isAvailable(): boolean {
    return hasYandexSpeechKitApiKey()
  }

  async synthesize(
    requestId: string,
    text: string,
    voice: CompanionYandexVoice,
    rate: number
  ): Promise<CompanionTtsYandexSynthesisChunk> {
    const api = YANDEX_VOICE_MIN_API[voice]
    const key = companionTtsCacheKey({ voice, api, rate, text })
    const cached = await this.cache.get(key)
    if (cached) {
      recordYandexTtsUsage(this.userDataDir, {
        characters: text.length,
        requestUnits: 0,
        costRub: 0,
        cacheHit: true,
        cacheHitSavingsRub: costForChars(api, text.length)
      })
      return cached
    }

    const result = await this.provider.synthesize(requestId, text, voice, rate)
    await this.cache.put(key, result)
    recordYandexTtsUsage(this.userDataDir, {
      characters: text.length,
      requestUnits: api === 'v1' ? 0 : 1,
      costRub: costForChars(api, text.length),
      cacheHit: false,
      cacheHitSavingsRub: 0
    })
    return result
  }

  cancel(requestId: string): void {
    this.provider.cancel(requestId)
  }
}
