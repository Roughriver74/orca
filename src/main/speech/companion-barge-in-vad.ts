// Silero VAD over the voice barge-in monitor's mic frames, so a possible interruption is
// confirmed as human speech rather than a chime or room noise. Its own vad-worker: the STT
// session's VAD is paused with STT capture while a reply plays. Keeps only the latest
// "speech in progress" verdict, which companion-voice-barge-in-gate.ts reads per frame.

import type { CompanionBargeInSpeechSource } from '../companion/companion-voice-barge-in-gate'
import { VadSegmentationService } from './vad-segmentation-service'

// Short enough for the verdict to follow syllables; long enough that a click is not speech.
const MIN_SPEECH_SECONDS = 0.1
const MIN_SILENCE_SECONDS = 0.1
const MAX_SEGMENT_SECONDS = 30

export type CompanionBargeInVad = CompanionBargeInSpeechSource & { dispose(): void }

/** `resolveModelPath` is asked at most once per reply — the model may land mid-session. */
export function createCompanionBargeInVad(
  resolveModelPath: () => string | null
): CompanionBargeInVad {
  let service: VadSegmentationService | null = null
  let speech: boolean | null = null
  let shouldResolveModel = true

  function stopService(): void {
    const stopping = service
    service = null
    speech = null
    void stopping?.stop()
  }

  function ensureService(): VadSegmentationService | null {
    if (service || !shouldResolveModel) {
      return service
    }
    shouldResolveModel = false
    const modelPath = resolveModelPath()
    if (!modelPath) {
      return null
    }
    const created: VadSegmentationService = new VadSegmentationService(
      {
        vadModelPath: modelPath,
        endOfUtteranceSeconds: MIN_SILENCE_SECONDS,
        maxUtteranceSeconds: MAX_SEGMENT_SECONDS,
        minSpeechDurationSeconds: MIN_SPEECH_SECONDS
      },
      () => undefined,
      (error) => {
        console.warn('[companion] barge-in VAD failed, confirming by loudness', error)
        if (service === created) {
          stopService()
        }
      },
      (detected) => {
        if (service === created) {
          speech = detected
        }
      }
    )
    service = created
    return created
  }

  return {
    feed(samples, sampleRate) {
      ensureService()?.feed(samples, sampleRate)
    },
    isSpeech: () => speech,
    reset() {
      shouldResolveModel = true
      if (speech !== null) {
        speech = false
      }
    },
    dispose() {
      shouldResolveModel = false
      stopService()
    }
  }
}
