// Builds the companion's VadSegmentationOptions from its settings + whatever focus
// models have actually finished downloading. Kept separate from speech.ts (the IPC
// layer) so the "which assets are ready, which settings matter" decision is a plain
// function the main-process wiring can call, not inline IPC-handler logic.

import type { CompanionVoiceFocusSettings } from '../../shared/companion-types'
import type { FocusModelManager } from './focus-model-manager'
import type { VadSegmentationOptions } from './vad-segmentation-service'

export const COMPANION_SESSION_ID = 'companion'

/**
 * Undefined when voice focus is off, or the Silero VAD model has not finished
 * downloading yet — callers pass that straight through to SttService.startDictation,
 * which falls back to the renderer's energy-threshold silence timer in that case.
 * Speaker-embedding/denoiser paths are each independently optional: a missing
 * speaker-embedding model just means no voice-focus verification this session
 * (fails open), not no VAD at all.
 */
export function buildCompanionVadOptions(
  sessionId: string,
  voiceFocus: CompanionVoiceFocusSettings,
  focusModels: FocusModelManager
): VadSegmentationOptions | undefined {
  if (sessionId !== COMPANION_SESSION_ID) {
    return undefined
  }
  if (!voiceFocus.enabled || !focusModels.isReady('silero-vad')) {
    return undefined
  }
  return {
    vadModelPath: focusModels.getModelPath('silero-vad'),
    endOfUtteranceSeconds: voiceFocus.endOfUtteranceSeconds,
    maxUtteranceSeconds: voiceFocus.maxUtteranceSeconds,
    speakerEmbeddingModelPath: focusModels.isReady('speaker-embedding-campplus')
      ? focusModels.getModelPath('speaker-embedding-campplus')
      : undefined,
    denoiserModelPath:
      voiceFocus.denoiserEnabled && focusModels.isReady('gtcrn-denoiser')
        ? focusModels.getModelPath('gtcrn-denoiser')
        : undefined
  }
}
