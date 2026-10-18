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
    if (companion.tts.ttsEnabled && !ttsInFlight) {
      // Why: provisioning reports its own error status to the settings pane; swallow the rejection here.
      ttsInFlight = deps
        .provisionTts(deps.reportTtsStatus)
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
  return {
    downloadSttModel: (modelId) => getSpeechModelManager(store).downloadModel(modelId),
    provisionTts: (onStatus) =>
      provisionCompanionTts(getAppEnvironment().getPath('userData'), onStatus),
    reportTtsStatus: reportTtsProvisioningStatus
  }
}
