import { describe, expect, it, vi } from 'vitest'
import type { CompanionSettings } from '../../shared/companion-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getDefaultCompanionSettings } from '../../shared/constants'

vi.mock('../speech/speech-runtime-service', () => ({ getSpeechModelManager: vi.fn() }))
vi.mock('./tts/companion-tts-provisioning', () => ({ provisionCompanionTts: vi.fn() }))
vi.mock('./companion-tts-status', () => ({ reportTtsProvisioningStatus: vi.fn() }))

import { initCompanionAssets, type CompanionAssetsDeps } from './companion-assets'

function makeStore(companion: CompanionSettings) {
  let current = companion
  let listener: ((updates: Partial<GlobalSettings>) => void) | null = null
  return {
    getSettings: () => ({ companion: current }),
    onSettingsChanged: (next: (updates: Partial<GlobalSettings>) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
    setCompanion(next: CompanionSettings) {
      current = next
      listener?.({ companion: next })
    }
  }
}

function makeDeps(overrides: Partial<CompanionAssetsDeps> = {}) {
  return {
    downloadSttModel: vi.fn(async (_modelId: string) => undefined),
    provisionTts: vi.fn(async () => undefined),
    reportTtsStatus: vi.fn(),
    ...overrides
  }
}

const enabled = (): CompanionSettings => ({ ...getDefaultCompanionSettings(), enabled: true })

describe('initCompanionAssets', () => {
  it('fetches nothing while the companion is disabled', () => {
    const deps = makeDeps()
    initCompanionAssets(makeStore(getDefaultCompanionSettings()), deps)
    expect(deps.downloadSttModel).not.toHaveBeenCalled()
    expect(deps.provisionTts).not.toHaveBeenCalled()
  })

  it('downloads the STT model and provisions TTS once the companion is enabled', () => {
    const deps = makeDeps()
    const store = makeStore(getDefaultCompanionSettings())
    initCompanionAssets(store, deps)
    store.setCompanion(enabled())
    expect(deps.downloadSttModel).toHaveBeenCalledWith(enabled().sttModel)
    expect(deps.provisionTts).toHaveBeenCalledTimes(1)
  })

  it('skips TTS provisioning when speech output is turned off', () => {
    const deps = makeDeps()
    const settings = enabled()
    initCompanionAssets(
      makeStore({ ...settings, tts: { ...settings.tts, ttsEnabled: false } }),
      deps
    )
    expect(deps.downloadSttModel).toHaveBeenCalledTimes(1)
    expect(deps.provisionTts).not.toHaveBeenCalled()
  })

  it('does not start a second provisioning while one is still running', () => {
    const pending = Promise.withResolvers<never>()
    const deps = makeDeps({ provisionTts: vi.fn(() => pending.promise) })
    const store = makeStore(enabled())
    initCompanionAssets(store, deps)
    store.setCompanion({ ...enabled(), hotkey: 'Control+J' })
    expect(deps.provisionTts).toHaveBeenCalledTimes(1)
  })

  it('retries provisioning on the next settings change after a failure', async () => {
    const provisionTts = vi.fn(async () => {
      throw new Error('network down')
    })
    const deps = makeDeps({ provisionTts })
    const store = makeStore(enabled())
    initCompanionAssets(store, deps)
    expect(provisionTts).toHaveBeenCalledTimes(1)
    // A settings change only retries once the rejected attempt has settled; poll by changing again.
    await vi.waitFor(() => {
      store.setCompanion({ ...enabled(), hotkey: 'Control+J' })
      expect(provisionTts).toHaveBeenCalledTimes(2)
    })
  })
})
