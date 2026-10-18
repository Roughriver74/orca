// Talks to Yandex SpeechKit directly over HTTPS — no sidecar process, unlike Silero,
// since this is a single authenticated request/response per text chunk. Picks v1
// (`tts:synthesize`, form body, raw PCM response) or v3 (`utteranceSynthesis`, JSON body,
// NDJSON-streamed response) by the voice's minimum supported API (see
// `YANDEX_VOICE_MIN_API` in ../../../shared/companion-types.ts).

import { YANDEX_VOICE_MIN_API, type CompanionYandexVoice } from '../../../shared/companion-types'
import { pcm16LEToFloat32 } from './companion-tts-pcm'
import { createYandexV3NdjsonParser } from './companion-tts-yandex-v3-protocol'
import { CompanionTtsYandexError, classifyYandexHttpStatus } from './companion-tts-yandex-errors'
import { CompanionTtsCancelledError } from './companion-tts-sidecar-process'

const V1_URL = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize'
const V3_URL = 'https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis'
const SAMPLE_RATE = 48_000
const REQUEST_TIMEOUT_MS = 15_000

export type CompanionTtsYandexSynthesisResult = {
  sampleRate: number
  pcm: Float32Array
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return response.statusText
  }
}

async function synthesizeV1(
  text: string,
  voice: CompanionYandexVoice,
  apiKey: string,
  rate: number,
  signal: AbortSignal
): Promise<CompanionTtsYandexSynthesisResult> {
  const body = new URLSearchParams({
    text,
    lang: 'ru-RU',
    voice,
    format: 'lpcm',
    sampleRateHertz: String(SAMPLE_RATE),
    // Verified 2026-10-18 against the real API with the user's key: speed in [0.1, 3.0], 1.0 = normal.
    speed: String(rate)
  })
  const response = await fetch(V1_URL, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${apiKey}` },
    body,
    signal
  })
  if (!response.ok) {
    throw new CompanionTtsYandexError(
      classifyYandexHttpStatus(response.status),
      await readErrorMessage(response)
    )
  }
  const pcmBuffer = Buffer.from(await response.arrayBuffer())
  return { sampleRate: SAMPLE_RATE, pcm: pcm16LEToFloat32(pcmBuffer) }
}

async function synthesizeV3(
  text: string,
  voice: CompanionYandexVoice,
  apiKey: string,
  rate: number,
  signal: AbortSignal
): Promise<CompanionTtsYandexSynthesisResult> {
  const response = await fetch(V3_URL, {
    method: 'POST',
    headers: { Authorization: `Api-Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      outputAudioSpec: {
        rawAudio: { audioEncoding: 'LINEAR16_PCM', sampleRateHertz: SAMPLE_RATE }
      },
      // Verified against the real API: a separate hint, not nested under the voice hint.
      hints: [{ voice }, { speed: rate }],
      loudnessNormalizationType: 'LUFS'
    }),
    signal
  })
  if (!response.ok) {
    throw new CompanionTtsYandexError(
      classifyYandexHttpStatus(response.status),
      await readErrorMessage(response)
    )
  }
  if (!response.body) {
    throw new CompanionTtsYandexError('unknown', 'empty response body')
  }
  const pcmParts: Buffer[] = []
  const decoder = new TextDecoder('utf8')
  const parser = createYandexV3NdjsonParser((base64) => {
    pcmParts.push(Buffer.from(base64, 'base64'))
  })
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    parser.feed(decoder.decode(value, { stream: true }))
  }
  parser.feed(decoder.decode())
  parser.flush()
  return { sampleRate: SAMPLE_RATE, pcm: pcm16LEToFloat32(Buffer.concat(pcmParts)) }
}

export class CompanionTtsYandexProvider {
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly readApiKey: () => string) {}

  async synthesize(
    requestId: string,
    text: string,
    voice: CompanionYandexVoice,
    rate: number
  ): Promise<CompanionTtsYandexSynthesisResult> {
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    // Why a separate flag, not just `controller.signal.aborted`: `cancel()` (user barge-in/
    // stop()) and this timeout both abort the same controller, but only a user cancel should
    // be swallowed silently — a timeout is a real failure the caller must fall back/report on,
    // same as a 5xx. Conflating them used to drop the chunk with no Silero fallback and no
    // error toast whenever Yandex merely took >15s to answer.
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, REQUEST_TIMEOUT_MS)
    try {
      const apiKey = this.readApiKey()
      const api = YANDEX_VOICE_MIN_API[voice]
      return api === 'v1'
        ? await synthesizeV1(text, voice, apiKey, rate, controller.signal)
        : await synthesizeV3(text, voice, apiKey, rate, controller.signal)
    } catch (error) {
      if (controller.signal.aborted) {
        if (timedOut) {
          throw new CompanionTtsYandexError('network', 'Yandex SpeechKit request timed out')
        }
        throw new CompanionTtsCancelledError(requestId)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      this.controllers.delete(requestId)
    }
  }

  /** Aborts an in-flight request; its `synthesize()` promise rejects with
   *  `CompanionTtsCancelledError`, matching the Silero sidecar's `cancel()` contract. */
  cancel(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }
}
