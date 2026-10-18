import type { SpeechModelDownloadFile } from '../../shared/speech-types'
import { huggingFaceFiles } from './model-download-catalog'

/**
 * Non-STT audio assets the companion downloads once "Голос владельца"/VAD focus is
 * enabled: a VAD model for real end-of-utterance detection, a speaker-embedding model
 * for voice verification, and an optional denoiser. Kept out of model-download-catalog.ts
 * / model-catalog.ts on purpose — those back the STT model picker in Settings
 * (SpeechModelManifest has no "vad"/"speaker-embedding"/"denoiser" SpeechModelType), and
 * these assets must never show up there.
 */
export type FocusModelId = 'silero-vad' | 'speaker-embedding-campplus' | 'gtcrn-denoiser'

export type FocusModelManifest = {
  id: FocusModelId
  label: string
  description: string
  downloadFiles: SpeechModelDownloadFile[]
  sizeBytes: number
  /** The single model file inside the asset's download dir. */
  modelFile: string
}

// Why these three models (see /Users/evgenijsikunov/assistant/voice-lab/focus/report.md for
// the measured numbers):
// - silero-vad: Silero VAD v5, the sherpa-onnx-bundled standard — small (2.3 MB), fast, and
//   the only VAD the bundled native addon's createVoiceActivityDetector() loads (sileroVad
//   config branch). No real alternative was considered: this *is* "the" sherpa-onnx VAD.
// - speaker-embedding-campplus: 3D-Speaker's CAM++ trained on VoxCeleb (en). CAM++'s
//   context-aware masking was designed specifically for short-utterance robustness (the
//   3D-Speaker paper reports it beating same-size ResNet/ECAPA variants on VoxCeleb1-O,
//   especially on short test segments) at ~28 MB — a fraction of ECAPA-TDNN-class models
//   for comparable accuracy. VoxCeleb (English) training does not make it English-only:
//   speaker embeddings encode vocal-tract/timbre characteristics, not phonetic content, so
//   verification generalizes across languages including Russian — the same reason
//   wespeaker/3D-Speaker ship no language-specific variant for this task.
// - gtcrn-denoiser: GTCRN, sherpa-onnx's smallest bundled speech-enhancement model
//   (<1 MB) — the task only needs "does this measurably help VAD/STT in TV-like noise",
//   not maximum enhancement quality, so the lightest model that is already wired into the
//   native addon (createOfflineSpeechDenoiser) was picked over DPDFNet (heavier).
const FOCUS_MODEL_DOWNLOAD_FILES: Record<FocusModelId, SpeechModelDownloadFile[]> = {
  'silero-vad': huggingFaceFiles('csukuangfj/vad', 'fba88cd2e921609e7675c3aaf51e0b9b295da4bc', [
    [
      'silero_vad_v5.onnx',
      2313101,
      '6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396'
    ]
  ]),
  'speaker-embedding-campplus': huggingFaceFiles(
    'csukuangfj/speaker-embedding-models',
    '0743f301363dec56491a490f6d6cbc9d67f9a3bf',
    [
      [
        '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
        29596978,
        '357a834f702b80161e5b981182c038e18553c1f2ca752ed6cec2052365d4129b'
      ]
    ]
  ),
  'gtcrn-denoiser': huggingFaceFiles(
    'csukuangfj/speech-enhancement-models',
    'ccf4b25730940483dbb210d7d251d56e1531d0b4',
    [
      [
        'gtcrn_simple.onnx',
        535638,
        'e77603ac0c23dac3227dd2d7135b3a585cbee2679048aecfa886657d3ae1b534'
      ]
    ]
  )
}

export const FOCUS_MODEL_CATALOG: FocusModelManifest[] = [
  {
    id: 'silero-vad',
    label: 'Silero VAD v5',
    description:
      'Определяет конец фразы по голосу, а не по громкости — не путает телевизор с тишиной.',
    downloadFiles: FOCUS_MODEL_DOWNLOAD_FILES['silero-vad'],
    sizeBytes: FOCUS_MODEL_DOWNLOAD_FILES['silero-vad'][0]?.sizeBytes ?? 0,
    modelFile: 'silero_vad_v5.onnx'
  },
  {
    id: 'speaker-embedding-campplus',
    label: 'CAM++ (speaker embedding)',
    description: 'Отличает голос владельца от чужих голосов и телевизора.',
    downloadFiles: FOCUS_MODEL_DOWNLOAD_FILES['speaker-embedding-campplus'],
    sizeBytes: FOCUS_MODEL_DOWNLOAD_FILES['speaker-embedding-campplus'][0]?.sizeBytes ?? 0,
    modelFile: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'
  },
  {
    id: 'gtcrn-denoiser',
    label: 'GTCRN (denoiser)',
    description: 'Подавляет фоновый шум перед распознаванием голоса (опционально).',
    downloadFiles: FOCUS_MODEL_DOWNLOAD_FILES['gtcrn-denoiser'],
    sizeBytes: FOCUS_MODEL_DOWNLOAD_FILES['gtcrn-denoiser'][0]?.sizeBytes ?? 0,
    modelFile: 'gtcrn_simple.onnx'
  }
]

export function getFocusModelManifest(id: FocusModelId): FocusModelManifest {
  const manifest = FOCUS_MODEL_CATALOG.find((m) => m.id === id)
  if (!manifest) {
    throw new Error(`Unknown focus model: ${id}`)
  }
  return manifest
}
