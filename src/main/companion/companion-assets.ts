import { getAppEnvironment } from '../../shared/app-environment'
import type {
  CompanionSettings,
  CompanionTtsProvisioningStatus
} from '../../shared/companion-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { VoiceSettings } from '../../shared/speech-types'
import { getSpeechModelManager } from '../speech/speech-runtime-service'
import { provisionCompanionTts } from './tts/companion-tts-provisioning'
import { reportTtsProvisioningStatus } from './companion-tts-status'

export type CompanionAssetsStore = {
  getSettings: () => { companion?: CompanionSettings; voice?: VoiceSettings }
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => () => void
}

export type CompanionAssetsDeps = {
  downloadSttModel: (modelId: string) => Promise<void>
  provisionTts: (onStatus: (status: CompanionTtsProvisioningStatus) => void) => Promise<unknown>
  reportTtsStatus: (status: CompanionTtsProvisioningStatus) => void
  // Why its own dep rather than chained inside provisionTts: prewarming is specific to
  // the Silero sidecar (CompanionTtsService.prewarm() itself skips the Yandex provider),
  // while provisionTts covers both the STT model path's sibling concern and tests that
  // stub provisioning without caring about the sidecar at all.
  prewarmTts: () => Promise<void>
}

/**
 * Fetches what an enabled companion needs (its STT model and the TTS runtime) as soon as it is
 * enabled, so the first hotkey press works on a fresh machine instead of failing "not provisioned".
 * Both steps are idempotent; a failed step retries on the next companion settings change.
 */
export function initCompanionAssets(
  store: CompanionAssetsStore,
  deps: CompanionAssetsDeps = createDefaultDeps(store)
): () => void {
  let ttsInFlight: Promise<unknown> | null = null
  let sttInFlight: Promise<void> | null = null

  const ensure = (): void => {
    const companion = store.getSettings().companion
    if (!companion?.enabled) {
      return
    }
    if (companion.sttModel && !sttInFlight) {
      sttInFlight = deps
        .downloadSttModel(companion.sttModel)
        .catch((error: unknown) => console.error('[companion] STT model download failed', error))
        .finally(() => {
          sttInFlight = null
        })
    }
    // Why `provider !== 'yandex'`: Silero is an 850 MB, ~8-minute download the companion
    // only needs as a fallback voice when the configured provider is the local one — a
    // Yandex-only setup should not pay that cost just because `ttsEnabled` is true.
    if (companion.tts.ttsEnabled && companion.tts.provider !== 'yandex' && !ttsInFlight) {
      // Why: provisioning reports its own error status to the settings pane; swallow the rejection here.
      // Prewarming only after a successful provision: an unprovisioned sidecar has no model
      // paths to spawn with, and CompanionTtsService.ensureSidecar() would just throw.
      ttsInFlight = deps
        .provisionTts(deps.reportTtsStatus)
        .then(() => deps.prewarmTts())
        .catch(() => undefined)
        .finally(() => {
          ttsInFlight = null
        })
    }
  }

  ensure()
  return store.onSettingsChanged((updates) => {
    if ('companion' in updates) {
      ensure()
    }
  })
}

function createDefaultDeps(store: CompanionAssetsStore): CompanionAssetsDeps {
  const userDataDir = getAppEnvironment().getPath('userData')
  return {
    downloadSttModel: (modelId) => getSpeechModelManager(store).downloadModel(modelId),
    provisionTts: (onStatus) => provisionCompanionTts(userDataDir, onStatus),
    reportTtsStatus: reportTtsProvisioningStatus,
    // Why dynamic: the TTS module pulls in the bundled `.py?asset&asarUnpack` sidecar path
    // at import time (see companion-dialogue.ts for the same pattern), which only resolves
    // inside a real (or asset-mocked) Vite/electron-vite build — a static import here would
    // force that resolution on every test that merely imports this file for `initCompanionAssets`.
    prewarmTts: async () => {
      const { getCompanionTtsService } = await import('./tts/companion-tts-service')
      await getCompanionTtsService(userDataDir).prewarm()
    }
  }
}
