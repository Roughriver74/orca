import { ipcRenderer } from 'electron'
import type { CompanionVoiceEnrollmentStatus } from '../../shared/companion-types'
import type { SpeechModelState } from '../../shared/speech-types'
import type { CompanionVoiceFocusApi } from './companion-voice-focus-api'

export const companionVoiceFocusApi = {
  getEnrollmentStatus: (): Promise<CompanionVoiceEnrollmentStatus> =>
    ipcRenderer.invoke('companion:voiceFocus:getEnrollmentStatus'),
  // Why a Buffer and not the Float32Array directly: contextBridge structured-clone can
  // zero out typed-array data crossing the boundary (same reason speech:feedAudio uses
  // Buffer — see src/preload/api/speech-bridge.ts).
  enrollPhrase: (
    samples: Float32Array,
    sampleRate: number
  ): Promise<CompanionVoiceEnrollmentStatus> =>
    ipcRenderer.invoke(
      'companion:voiceFocus:enrollPhrase',
      Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength),
      sampleRate
    ),
  clearEnrollment: (): Promise<CompanionVoiceEnrollmentStatus> =>
    ipcRenderer.invoke('companion:voiceFocus:clearEnrollment'),
  getAssetStatus: (): Promise<SpeechModelState[]> =>
    ipcRenderer.invoke('companion:voiceFocus:getAssetStatus'),
  downloadAsset: (
    id: 'silero-vad' | 'speaker-embedding-campplus' | 'gtcrn-denoiser'
  ): Promise<void> => ipcRenderer.invoke('companion:voiceFocus:downloadAsset', id)
} satisfies CompanionVoiceFocusApi
