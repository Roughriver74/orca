// Split into its own tiny file for the same reason `initCompanionTtsProviderSettings` does
// (see companion-tts-provider-settings-wiring.ts): companion-tts-service.ts pulls in the
// bundled `.py?asset&asarUnpack` TTS sidecar path at import time, which only resolves inside
// a real Vite/electron-vite build. `companion-dialogue.ts`'s `initCompanionDialogue` needs a
// *synchronous* `getTtsService(userDataDir)` for its hotkey/voice turn flow, so this fires the
// dynamic import once at startup and caches the resolved accessor — the same best-effort
// prewarm `initCompanionTtsProviderSettings` already relies on (by the time a user actually
// speaks, the import has long since resolved). Keeping the dynamic import behind a named
// function here also gives register-core-handlers.test.ts one module to mock away, matching
// how it already mocks `initCompanionDialogue` and `initCompanionTtsProviderSettings`.

import type { CompanionTtsService } from './companion-tts-service'

let cachedGetTtsService: ((userDataDir: string) => CompanionTtsService) | undefined

/** Call once at startup; safe to call more than once (idempotent re-fire). */
export function startCompanionTtsServiceWarmup(): void {
  void import('./companion-tts-service').then((mod) => {
    cachedGetTtsService = mod.getCompanionTtsService
  })
}

/** Null until the warmup's dynamic import resolves, or if it was never started. */
export function getWarmedCompanionTtsService(userDataDir: string): CompanionTtsService | null {
  return cachedGetTtsService?.(userDataDir) ?? null
}
