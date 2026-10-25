// Runs the acoustic wake-phrase detector (wake-keyword-spotter-service.ts) while wake mode
// and its `keywordSpotter` flag are on and the model is downloaded. It listens to the same
// companion mic stream the panel feeds to STT, but outlives the per-utterance STT restarts.

import type { CompanionSettings } from '../../shared/companion-types'
import { COMPANION_SESSION_ID } from '../speech/companion-vad-options'
import { getFocusModelManager } from '../speech/focus-model-manager'
import { WakeKeywordSpotterService } from '../speech/wake-keyword-spotter-service'

const MODEL_ID = 'wake-keyword-spotter-ru'

type SyncRequest = { companion: CompanionSettings; onKeyword: (phrase: string) => void }

let spotter: WakeKeywordSpotterService | null = null
let spotterPhrases = ''
let latestRequest: SyncRequest | null = null
let stopWatchingModel: (() => void) | null = null

/** While true, the wake gate requires a spotter hit for a transcript wake phrase to count. */
export function isCompanionWakeKeywordSpotterActive(): boolean {
  return spotter !== null
}

function stopSpotter(): void {
  void spotter?.stop()
  spotter = null
}

export function stopCompanionWakeKeywordSpotter(): void {
  stopSpotter()
  stopWatchingModel?.()
  stopWatchingModel = null
  latestRequest = null
}

/** Starts, restarts (phrases changed) or stops the spotter to match `companion`. */
export function syncCompanionWakeKeywordSpotter(
  companion: CompanionSettings,
  onKeyword: (phrase: string) => void
): void {
  const wanted = companion.enabled && companion.wake.enabled && companion.wake.keywordSpotter
  const phrases = companion.wake.phrases.join('\n')
  if (spotter && (!wanted || phrases !== spotterPhrases)) {
    stopSpotter()
  }
  if (!wanted) {
    stopCompanionWakeKeywordSpotter()
    return
  }
  latestRequest = { companion, onKeyword }
  if (spotter) {
    return
  }
  // Why only past the flag check: the manager touches userData on creation, and most
  // installs never turn the spotter on.
  const models = getFocusModelManager()
  if (!models.isReady(MODEL_ID)) {
    // companion-assets.ts downloads the model once the flag is on; start when it lands.
    stopWatchingModel ??= models.setProgressCallback((id) => {
      if (id === MODEL_ID && latestRequest && models.isReady(MODEL_ID)) {
        syncCompanionWakeKeywordSpotter(latestRequest.companion, latestRequest.onKeyword)
      }
    })
    return
  }
  stopWatchingModel?.()
  stopWatchingModel = null
  spotterPhrases = phrases
  const started = new WakeKeywordSpotterService(
    { modelDir: models.getAssetDir(MODEL_ID), phrases: companion.wake.phrases },
    {
      onKeyword: (phrase) => {
        console.log('[companion] wake keyword heard:', phrase)
        onKeyword(phrase)
      },
      // Why stop on error: the gate falls back to transcript matching instead of
      // waiting forever for hits from a spotter that is not running.
      onError: (error) => {
        console.error('[companion] wake keyword spotter failed', error)
        if (spotter === started) {
          stopSpotter()
        }
      }
    }
  )
  spotter = started
}

/** Mirrors every companion `speech:feedAudio` chunk to the spotter, if running. */
export function feedCompanionWakeKeywordSpotter(
  samples: Float32Array,
  sampleRate: number,
  sessionId: string
): void {
  if (sessionId === COMPANION_SESSION_ID) {
    spotter?.feed(samples, sampleRate)
  }
}
