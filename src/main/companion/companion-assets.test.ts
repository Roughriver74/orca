import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompanionSettings } from '../../shared/companion-types'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getDefaultCompanionSettings } from '../../shared/constants'

vi.mock('../speech/speech-runtime-service', () => ({ getSpeechModelManager: vi.fn() }))
vi.mock('./tts/companion-tts-provisioning', () => ({ provisionCompanionTts: vi.fn() }))
vi.mock('./tts/companion-tts-qwen3-provisioning', () => ({ provisionCompanionTtsQwen3: vi.fn() }))
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
    provisionQwen3Tts: vi.fn(async () => undefined),
    reportTtsStatus: vi.fn(),
    prewarmTts: vi.fn(async () => undefined),
    downloadFocusModel: vi.fn(async (_id: string) => undefined),
    ...overrides
  }
}

const enabled = (): CompanionSettings => ({ ...getDefaultCompanionSettings(), enabled: true })

const realPlatform = process.platform
const realArch = process.arch

function onHost(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
}

const withQwen3 = (): CompanionSettings => {
  const settings = enabled()
  return { ...settings, tts: { ...settings.tts, provider: 'qwen3' } }
}

describe('initCompanionAssets', () => {
  afterEach(() => onHost(realPlatform, realArch))

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

  it('prewarms the Silero sidecar once TTS provisioning succeeds', async () => {
    const deps = makeDeps()
    const store = makeStore(getDefaultCompanionSettings())
    initCompanionAssets(store, deps)
    store.setCompanion(enabled())
    await vi.waitFor(() => {
      expect(deps.prewarmTts).toHaveBeenCalledTimes(1)
    })
  })

  it('does not prewarm when the provider is Yandex', async () => {
    const deps = makeDeps()
    const settings = enabled()
    initCompanionAssets(
      makeStore({ ...settings, tts: { ...settings.tts, provider: 'yandex' } }),
      deps
    )
    expect(deps.provisionTts).not.toHaveBeenCalled()
    expect(deps.prewarmTts).not.toHaveBeenCalled()
  })

  it('does not prewarm when provisioning fails', async () => {
    const provisionTts = vi.fn(async () => {
      throw new Error('network down')
    })
    const deps = makeDeps({ provisionTts })
    initCompanionAssets(makeStore(enabled()), deps)
    await vi.waitFor(() => {
      expect(provisionTts).toHaveBeenCalledTimes(1)
    })
    expect(deps.prewarmTts).not.toHaveBeenCalled()
  })

  it('never fetches Qwen3 for the default Silero provider', async () => {
    const deps = makeDeps()
    initCompanionAssets(makeStore(enabled()), deps)
    await vi.waitFor(() => expect(deps.prewarmTts).toHaveBeenCalledTimes(1))
    expect(deps.provisionQwen3Tts).not.toHaveBeenCalled()
  })

  it('provisions Qwen3 after Silero once it is selected, then prewarms again', async () => {
    onHost('darwin', 'arm64')
    const order: string[] = []
    const deps = makeDeps({
      provisionTts: vi.fn(async () => order.push('silero')),
      provisionQwen3Tts: vi.fn(async () => order.push('qwen3'))
    })
    initCompanionAssets(makeStore(withQwen3()), deps)
    await vi.waitFor(() => expect(deps.prewarmTts).toHaveBeenCalledTimes(2))
    expect(order).toEqual(['silero', 'qwen3'])
  })

  it('keeps Silero prewarmed when the Qwen3 download fails', async () => {
    onHost('darwin', 'arm64')
    const deps = makeDeps({
      provisionQwen3Tts: vi.fn(async () => {
        throw new Error('huggingface down')
      })
    })
    initCompanionAssets(makeStore(withQwen3()), deps)
    await vi.waitFor(() => expect(deps.provisionQwen3Tts).toHaveBeenCalledTimes(1))
    expect(deps.prewarmTts).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['linux', 'x64'],
    ['darwin', 'x64']
  ])('on %s/%s a qwen3 selection provisions only Silero', async (platform, arch) => {
    onHost(platform, arch)
    const deps = makeDeps()
    initCompanionAssets(makeStore(withQwen3()), deps)
    await vi.waitFor(() => expect(deps.prewarmTts).toHaveBeenCalledTimes(1))
    expect(deps.provisionTts).toHaveBeenCalledTimes(1)
    expect(deps.provisionQwen3Tts).not.toHaveBeenCalled()
  })
})

describe('initCompanionAssets voiceFocus assets', () => {
  it('does nothing when voiceFocus is disabled', () => {
    const deps = makeDeps()
    initCompanionAssets(makeStore(enabled()), deps)
    expect(deps.downloadFocusModel).not.toHaveBeenCalled()
  })

  it('downloads the VAD and speaker-embedding models once voiceFocus is enabled', () => {
    const companion = { ...enabled(), voiceFocus: { ...enabled().voiceFocus, enabled: true } }
    const deps = makeDeps()
    initCompanionAssets(makeStore(companion), deps)
    expect(deps.downloadFocusModel).toHaveBeenCalledWith('silero-vad')
    expect(deps.downloadFocusModel).toHaveBeenCalledWith('speaker-embedding-campplus')
    expect(deps.downloadFocusModel).not.toHaveBeenCalledWith('gtcrn-denoiser')
  })

  it('also downloads the denoiser once that setting is on', () => {
    const companion = {
      ...enabled(),
      voiceFocus: { ...enabled().voiceFocus, enabled: true, denoiserEnabled: true }
    }
    const deps = makeDeps()
    initCompanionAssets(makeStore(companion), deps)
    expect(deps.downloadFocusModel).toHaveBeenCalledWith('gtcrn-denoiser')
  })

  it('does not start a second round while one is still running', () => {
    let resolveDownload: (() => void) | undefined
    const deps = makeDeps({
      downloadFocusModel: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveDownload = resolve
          })
      )
    })
    const companion = { ...enabled(), voiceFocus: { ...enabled().voiceFocus, enabled: true } }
    const store = makeStore(companion)
    initCompanionAssets(store, deps)
    store.setCompanion({ ...companion })
    expect(deps.downloadFocusModel).toHaveBeenCalledTimes(2)
    resolveDownload?.()
  })
})
