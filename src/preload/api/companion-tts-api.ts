import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import type { CompanionTtsUsageSnapshot } from '../../shared/companion-types'

type YandexKeyStatus = { configured: boolean; protection: SecretAtRestProtection | null }

export type CompanionTtsApi = {
  getYandexKeyStatus: () => Promise<YandexKeyStatus>
  saveYandexApiKey: (apiKey: string) => Promise<YandexKeyStatus>
  clearYandexApiKey: () => Promise<YandexKeyStatus>
  testYandexApiKey: () => Promise<{ ok: boolean; message?: string }>
  getUsage: () => Promise<CompanionTtsUsageSnapshot>
}
