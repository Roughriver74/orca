import { ipcMain } from 'electron'
import { getAppEnvironment } from '../../shared/app-environment'
import { getDefaultCompanionSettings } from '../../shared/constants'
import type { CompanionSettings, CompanionTtsUsageSnapshot } from '../../shared/companion-types'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import {
  clearYandexSpeechKitApiKey,
  getYandexSpeechKitApiKeyProtection,
  hasYandexSpeechKitApiKey,
  readYandexSpeechKitApiKey,
  saveYandexSpeechKitApiKey
} from '../companion/tts/companion-tts-yandex-key-store'
import { getCompanionTtsUsageSnapshot } from '../companion/tts/companion-tts-usage'
import { CompanionTtsYandexProvider } from '../companion/tts/companion-tts-yandex-provider'
import { describeYandexErrorRu } from '../companion/tts/companion-tts-yandex-errors'

export type CompanionTtsIpcStore = { getSettings: () => { companion?: CompanionSettings } }

type KeyStatus = { configured: boolean; protection: SecretAtRestProtection | null }

function keyStatus(): KeyStatus {
  return {
    configured: hasYandexSpeechKitApiKey(),
    protection: getYandexSpeechKitApiKeyProtection()
  }
}

export function registerCompanionTtsHandlers(store: CompanionTtsIpcStore): void {
  ipcMain.removeHandler('companion:getYandexKeyStatus')
  ipcMain.removeHandler('companion:saveYandexApiKey')
  ipcMain.removeHandler('companion:clearYandexApiKey')
  ipcMain.removeHandler('companion:testYandexApiKey')
  ipcMain.removeHandler('companion:getTtsUsage')

  ipcMain.handle('companion:getYandexKeyStatus', (): KeyStatus => keyStatus())

  ipcMain.handle('companion:saveYandexApiKey', (_event, apiKey: unknown): KeyStatus => {
    if (typeof apiKey !== 'string') {
      throw new Error('Yandex SpeechKit API key must be a string')
    }
    saveYandexSpeechKitApiKey(apiKey)
    return keyStatus()
  })

  ipcMain.handle('companion:clearYandexApiKey', (): KeyStatus => {
    clearYandexSpeechKitApiKey()
    return keyStatus()
  })

  // Why a one-off provider (not the cached/usage-tracked CompanionTtsYandexSpeaker): this
  // is a settings-pane connectivity check, not a spoken reply — it should neither warm
  // the audio cache with "тест" nor count against the monthly budget.
  ipcMain.handle(
    'companion:testYandexApiKey',
    async (): Promise<{ ok: boolean; message?: string }> => {
      const tts = store.getSettings().companion?.tts ?? getDefaultCompanionSettings().tts
      const provider = new CompanionTtsYandexProvider(readYandexSpeechKitApiKey)
      try {
        await provider.synthesize('settings-test', 'тест', tts.yandexVoice)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: describeYandexErrorRu(error) }
      }
    }
  )

  ipcMain.handle('companion:getTtsUsage', (): CompanionTtsUsageSnapshot => {
    const tts = store.getSettings().companion?.tts ?? getDefaultCompanionSettings().tts
    return getCompanionTtsUsageSnapshot(
      getAppEnvironment().getPath('userData'),
      tts.yandexMonthlyBudgetRub
    )
  })
}
