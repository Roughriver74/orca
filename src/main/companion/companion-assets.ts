import { getAppEnvironment } from '../../shared/app-environment'
import type {
  CompanionSettings,
  CompanionTtsProvisioningStatus
} from '../../shared/companion-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { VoiceSettings } from '../../shared/speech-types'
import { getSpeechModelManager } from '../speech/speech-runtime-service'
import type { FocusModelId } from '../speech/focus-model-catalog'
import { getFocusModelManager } from '../speech/focus-model-manager'
import {
  ensureCompanionTtsSileroV56,
  provisionCompanionTts
} from './tts/companion-tts-provisioning'
import { provisionCompanionTtsQwen3 } from './tts/companion-tts-qwen3-provisioning'
import { isCompanionQwen3TtsSupported } from '../../shared/companion-tts-support'
import { reportTtsProvisioningStatus } from './companion-tts-status'

export type CompanionAssetsStore = {
  getSettings: () => { companion?: CompanionSettings; voice?: VoiceSettings }
  onSettingsChanged: (listener: (updates: Partial<GlobalSettings>) => void) => () => void
}

export type CompanionAssetsDeps = {
  downloadSttModel: (modelId: string) => Promise<void>
  provisionTts: (onStatus: (status: CompanionTtsProvisioningStatus) => void) => Promise<unknown>
  /** The optional Qwen3-TTS engine (~3 GB), fetched only once it is the selected provider. */
  provisionQwen3Tts: (
    onStatus: (status: CompanionTtsProvisioningStatus) => void
  ) => Promise<unknown>
  reportTtsStatus: (status: CompanionTtsProvisioningStatus) => void
  /** Optional Silero v5_6 after the required install; true when it was just downloaded. */
  downloadSileroV56: () => Promise<boolean>
  /** Restarts a running Silero sidecar so it picks up the v5_6 model. */
  reloadSileroTts: () => Promise<void>
  // Why its own dep rather than chained inside provisionTts: prewarming is specific to
  // the Silero sidecar (CompanionTtsService.prewarm() itself skips the Yandex provider),
  // while provisionTts covers both the STT model path's sibling concern and tests that
  // stub provisioning without caring about the sidecar at all.
  prewarmTts: () => Promise<void>
  // Why its own dep rather than reusing downloadSttModel: these are not STT models (no
  // SpeechModelManifest entry, never shown in the model picker) — see
  // src/main/speech/focus-model-catalog.ts / focus-model-manager.ts.
  downloadFocusModel: (id: FocusModelId) => Promise<void>
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
  let sileroV56InFlight: Promise<void> | null = null
  let qwen3InFlight: Promise<unknown> | null = null
  let sttInFlight: Promise<void> | null = null
  let voiceFocusInFlight: Promise<void> | null = null
  let wakeKeywordInFlight: Promise<void> | null = null

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
      // paths to spawn with, and CompanionTtsSileroSidecar.ensure() would just throw.
      ttsInFlight = deps
        .provisionTts(deps.reportTtsStatus)
        .then(() => deps.prewarmTts())
        .catch(() => undefined)
        .finally(() => {
          ttsInFlight = null
        })
    }
    // Why not inside provisionTts: models.silero.ai has served v5_6 at ~30 KB/s, and the
    // Qwen3 download chained on ttsInFlight below must not wait the better part of an hour.
    if (companion.tts.ttsEnabled && companion.tts.provider !== 'yandex' && !sileroV56InFlight) {
      sileroV56InFlight = (ttsInFlight ?? Promise.resolve())
        .then(() => deps.downloadSileroV56())
        .then((downloaded) => (downloaded ? deps.reloadSileroTts() : undefined))
        .catch((error: unknown) =>
          console.warn('[companion] Silero v5_6 download failed, staying on v5_4/v3_1', error)
        )
        .finally(() => {
          sileroV56InFlight = null
        })
    }
    // After Silero (its fallback), so the settings row ends on the Qwen3 status; a failed
    // Qwen3 download is reported there and leaves Silero speaking. Never off Apple Silicon:
    // there `qwen3` just means Silero, with no mlx install attempt.
    if (
      companion.tts.ttsEnabled &&
      companion.tts.provider === 'qwen3' &&
      isCompanionQwen3TtsSupported(process.platform, process.arch) &&
      !qwen3InFlight
    ) {
      qwen3InFlight = (ttsInFlight ?? Promise.resolve())
        .then(() => deps.provisionQwen3Tts(deps.reportTtsStatus))
        .then(() => deps.prewarmTts())
        .catch(() => undefined)
        .finally(() => {
          qwen3InFlight = null
        })
    }
    // Why always silero-vad + the speaker-embedding model once voiceFocus is enabled
    // (rather than gating speaker-embedding on enrollment existing): enrollment can
    // happen the moment Settings opens, and that recording flow needs the model
    // downloaded already, not kicked off then. gtcrn-denoiser is the one asset gated
    // further, on its own setting, since most rooms will not need it.
    if (companion.voiceFocus.enabled && !voiceFocusInFlight) {
      const assetIds: FocusModelId[] = ['silero-vad', 'speaker-embedding-campplus']
      if (companion.voiceFocus.denoiserEnabled) {
        assetIds.push('gtcrn-denoiser')
      }
      voiceFocusInFlight = Promise.all(
        assetIds.map((id) =>
          deps
            .downloadFocusModel(id)
            .catch((error: unknown) =>
              console.error('[voiceFocus] model download failed', id, error)
            )
        )
      )
        .then(() => undefined)
        .finally(() => {
          voiceFocusInFlight = null
        })
    }
    if (companion.wake.enabled && companion.wake.keywordSpotter && !wakeKeywordInFlight) {
      wakeKeywordInFlight = deps
        .downloadFocusModel('wake-keyword-spotter-ru')
        .catch((error: unknown) =>
          console.error('[companion] wake keyword model download failed', error)
        )
        .finally(() => {
          wakeKeywordInFlight = null
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
    provisionQwen3Tts: (onStatus) => provisionCompanionTtsQwen3(userDataDir, onStatus),
    reportTtsStatus: reportTtsProvisioningStatus,
    // Why dynamic: the TTS module pulls in the bundled `.py?asset&asarUnpack` sidecar path
    // at import time (see companion-dialogue.ts for the same pattern), which only resolves
    // inside a real (or asset-mocked) Vite/electron-vite build — a static import here would
    // force that resolution on every test that merely imports this file for `initCompanionAssets`.
    prewarmTts: async () => {
      const { getCompanionTtsService } = await import('./tts/companion-tts-service')
      await getCompanionTtsService(userDataDir).prewarm()
    },
    downloadSileroV56: () => ensureCompanionTtsSileroV56(userDataDir),
    // Dynamic for the same reason as prewarmTts above.
    reloadSileroTts: async () => {
      const { getCompanionTtsService } = await import('./tts/companion-tts-service')
      await getCompanionTtsService(userDataDir).reloadSileroModels()
    },
    downloadFocusModel: (id) => getFocusModelManager().download(id)
  }
}
