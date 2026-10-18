// Wires the live settings store into CompanionTtsService's provider-selection seam
// (see `setCompanionTtsProviderSettingsSource` in ./companion-tts-service.ts). Split into
// its own tiny file — not inlined into register-core-handlers.ts — for the same reason
// `initCompanionDialogue` does its own dynamic import: companion-tts-service.ts pulls in
// the bundled TTS sidecar asset path at import time, which only resolves inside a real
// Vite/electron-vite build. Keeping the dynamic import behind a named function here (not
// inline at a call site) also gives register-core-handlers.test.ts one module to mock
// away, matching how it already mocks `initCompanionDialogue` and `registerCompanionHandlers`.

import type { CompanionSettings } from '../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../shared/constants'

export type CompanionTtsProviderSettingsStore = {
  getSettings: () => { companion?: CompanionSettings }
}

export function initCompanionTtsProviderSettings(store: CompanionTtsProviderSettingsStore): void {
  void import('./companion-tts-service').then(({ setCompanionTtsProviderSettingsSource }) => {
    setCompanionTtsProviderSettingsSource(
      () => store.getSettings().companion?.tts ?? getDefaultCompanionSettings().tts
    )
  })
}
