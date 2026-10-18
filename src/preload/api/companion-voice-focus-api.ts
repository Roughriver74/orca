import type { CompanionVoiceEnrollmentStatus } from '../../shared/companion-types'
import type { SpeechModelState } from '../../shared/speech-types'

export type CompanionVoiceFocusApi = {
  getEnrollmentStatus: () => Promise<CompanionVoiceEnrollmentStatus>
  /** `samples`/`sampleRate` are the renderer's raw mic capture — resampled to 16 kHz on
   *  the main side (same as speech:feedAudio) before computing the embedding. Throws
   *  `voice_focus_model_not_ready` if the speaker-embedding model has not finished
   *  downloading yet. */
  enrollPhrase: (
    samples: Float32Array,
    sampleRate: number
  ) => Promise<CompanionVoiceEnrollmentStatus>
  clearEnrollment: () => Promise<CompanionVoiceEnrollmentStatus>
  /** VAD / speaker-embedding / denoiser download state, for the Settings pane. */
  getAssetStatus: () => Promise<SpeechModelState[]>
  downloadAsset: (
    id: 'silero-vad' | 'speaker-embedding-campplus' | 'gtcrn-denoiser'
  ) => Promise<void>
}
