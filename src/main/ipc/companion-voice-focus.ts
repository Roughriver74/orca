// Separate from src/main/ipc/companion.ts and src/main/ipc/speech.ts on purpose: these
// `companion:voiceFocus:*` channels are new surface (enrollment + focus-asset download
// status) that does not touch the existing dictation/companion IPC at all, so it can land
// independently of in-flight work on those files.
import { app, ipcMain } from 'electron'
import type { SpeechModelState } from '../../shared/speech-types'
import type { CompanionVoiceEnrollmentStatus } from '../../shared/companion-types'
import {
  addVoiceEnrollmentPhrase,
  clearVoiceEnrollment,
  getVoiceEnrollmentStatus
} from '../companion/companion-voice-enrollment'
import { getFocusModelManager } from '../speech/focus-model-manager'
import { getSherpaModulePath, LOCAL_SPEECH_UNAVAILABLE_ERROR } from '../speech/stt-worker-paths'
import {
  SpeakerEmbeddingExtractor,
  type SpeakerEmbeddingBinding
} from '../speech/speaker-embedding-extractor'
import { resampleToRate } from '../speech/stt-audio-resample'

const ENROLLMENT_SAMPLE_RATE = 16000

let cachedExtractor: SpeakerEmbeddingExtractor | null = null
let cachedExtractorModelPath: string | null = null

/** Lazily loads the native addon on the main thread and builds the speaker-embedding
 *  extractor used for enrollment (a rare, Settings-only action — no worker needed; the
 *  live listening path computes embeddings in vad-worker.ts instead). Rebuilt if the
 *  underlying model path ever changes (e.g. a re-download). */
function getEnrollmentExtractor(): SpeakerEmbeddingExtractor {
  const modelPath = getFocusModelManager().getModelPath('speaker-embedding-campplus')
  if (cachedExtractor && cachedExtractorModelPath === modelPath) {
    return cachedExtractor
  }
  const sherpaModulePath = getSherpaModulePath()
  if (!sherpaModulePath) {
    throw new Error(LOCAL_SPEECH_UNAVAILABLE_ERROR)
  }
  // SAFETY: the sherpa-onnx native addon has no type definitions; this is the same
  // narrow native-binding cast SpeakerEmbeddingExtractor's other callers use.
  const sherpa = require(sherpaModulePath) as unknown as SpeakerEmbeddingBinding
  cachedExtractor = new SpeakerEmbeddingExtractor(sherpa, { modelPath })
  cachedExtractorModelPath = modelPath
  return cachedExtractor
}

export function registerCompanionVoiceFocusHandlers(): void {
  ipcMain.removeHandler('companion:voiceFocus:getEnrollmentStatus')
  ipcMain.removeHandler('companion:voiceFocus:enrollPhrase')
  ipcMain.removeHandler('companion:voiceFocus:clearEnrollment')
  ipcMain.removeHandler('companion:voiceFocus:getAssetStatus')
  ipcMain.removeHandler('companion:voiceFocus:downloadAsset')

  const userDataDir = (): string => app.getPath('userData')

  ipcMain.handle('companion:voiceFocus:getEnrollmentStatus', (): CompanionVoiceEnrollmentStatus =>
    getVoiceEnrollmentStatus(userDataDir())
  )

  // Why the extractor runs here and not in the renderer: the native addon needs
  // Node/filesystem access the sandboxed renderer does not have (same reason STT runs in
  // main — see stt-worker.ts). `buffer`/`sampleRate` are the renderer's raw mic capture,
  // resampled to ENROLLMENT_SAMPLE_RATE here exactly like speech:feedAudio's worker does.
  ipcMain.handle(
    'companion:voiceFocus:enrollPhrase',
    (_event, buffer: Buffer, sampleRate: number): CompanionVoiceEnrollmentStatus => {
      if (!getFocusModelManager().isReady('speaker-embedding-campplus')) {
        throw new Error('voice_focus_model_not_ready')
      }
      const raw = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
      const samples = resampleToRate(raw, sampleRate, ENROLLMENT_SAMPLE_RATE)
      const embedding = getEnrollmentExtractor().computeEmbedding(samples, ENROLLMENT_SAMPLE_RATE)
      addVoiceEnrollmentPhrase(userDataDir(), embedding)
      return getVoiceEnrollmentStatus(userDataDir())
    }
  )

  ipcMain.handle('companion:voiceFocus:clearEnrollment', (): CompanionVoiceEnrollmentStatus => {
    clearVoiceEnrollment(userDataDir())
    return getVoiceEnrollmentStatus(userDataDir())
  })

  ipcMain.handle('companion:voiceFocus:getAssetStatus', (): SpeechModelState[] =>
    getFocusModelManager().getAllAssetStates()
  )

  ipcMain.handle('companion:voiceFocus:downloadAsset', async (_event, id: string) => {
    if (id !== 'silero-vad' && id !== 'speaker-embedding-campplus' && id !== 'gtcrn-denoiser') {
      throw new Error(`Unknown focus model: ${id}`)
    }
    await getFocusModelManager().download(id)
  })
}

// Test-only: lets tests reset the cached extractor between runs.
export function resetEnrollmentExtractorForTesting(): void {
  cachedExtractor = null
  cachedExtractorModelPath = null
}
