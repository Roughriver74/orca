import { describe, expect, it } from 'vitest'
import { buildCompanionVadOptions } from './companion-vad-options'
import type { CompanionVoiceFocusSettings } from '../../shared/companion-types'
import type { FocusModelManager } from './focus-model-manager'
import type { FocusModelId } from './focus-model-catalog'

function voiceFocus(
  overrides: Partial<CompanionVoiceFocusSettings> = {}
): CompanionVoiceFocusSettings {
  return {
    enabled: true,
    endOfUtteranceSeconds: 2,
    maxUtteranceSeconds: 60,
    denoiserEnabled: false,
    strictness: 'medium',
    showDropped: false,
    ...overrides
  }
}

function fakeFocusModels(ready: FocusModelId[]): FocusModelManager {
  return {
    isReady: (id: FocusModelId) => ready.includes(id),
    getModelPath: (id: FocusModelId) => `/models/${id}.onnx`
  } as unknown as FocusModelManager
}

describe('buildCompanionVadOptions', () => {
  it('is undefined for a non-companion session regardless of settings', () => {
    expect(
      buildCompanionVadOptions('desktop', voiceFocus(), fakeFocusModels(['silero-vad']))
    ).toBeUndefined()
  })

  it('is undefined when voice focus is disabled', () => {
    expect(
      buildCompanionVadOptions(
        'companion',
        voiceFocus({ enabled: false }),
        fakeFocusModels(['silero-vad'])
      )
    ).toBeUndefined()
  })

  it('is undefined when the Silero VAD model has not finished downloading', () => {
    expect(buildCompanionVadOptions('companion', voiceFocus(), fakeFocusModels([]))).toBeUndefined()
  })

  it('builds VAD-only options when no speaker-embedding model is ready (fails open on verification)', () => {
    const options = buildCompanionVadOptions(
      'companion',
      voiceFocus(),
      fakeFocusModels(['silero-vad'])
    )
    expect(options).toEqual({
      vadModelPath: '/models/silero-vad.onnx',
      endOfUtteranceSeconds: 2,
      maxUtteranceSeconds: 60,
      speakerEmbeddingModelPath: undefined,
      denoiserModelPath: undefined
    })
  })

  it('includes the speaker-embedding model path once it is ready', () => {
    const options = buildCompanionVadOptions(
      'companion',
      voiceFocus(),
      fakeFocusModels(['silero-vad', 'speaker-embedding-campplus'])
    )
    expect(options?.speakerEmbeddingModelPath).toBe('/models/speaker-embedding-campplus.onnx')
  })

  it('includes the denoiser model path only when both denoiserEnabled and the asset are ready', () => {
    const notEnabled = buildCompanionVadOptions(
      'companion',
      voiceFocus({ denoiserEnabled: false }),
      fakeFocusModels(['silero-vad', 'gtcrn-denoiser'])
    )
    expect(notEnabled?.denoiserModelPath).toBeUndefined()

    const notReady = buildCompanionVadOptions(
      'companion',
      voiceFocus({ denoiserEnabled: true }),
      fakeFocusModels(['silero-vad'])
    )
    expect(notReady?.denoiserModelPath).toBeUndefined()

    const ready = buildCompanionVadOptions(
      'companion',
      voiceFocus({ denoiserEnabled: true }),
      fakeFocusModels(['silero-vad', 'gtcrn-denoiser'])
    )
    expect(ready?.denoiserModelPath).toBe('/models/gtcrn-denoiser.onnx')
  })
})
