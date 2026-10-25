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
export type FocusModelId =
  | 'silero-vad'
  | 'speaker-embedding-campplus'
  | 'gtcrn-denoiser'
  | 'wake-keyword-spotter-ru'

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
// - wake-keyword-spotter-ru: Vosk's small streaming Russian zipformer transducer (int8),
//   run through sherpa-onnx's KeywordSpotter. No Russian KWS-specific model exists, but the
//   spotter is open-vocabulary over any streaming transducer's BPE pieces, so wake phrases
//   need no training. Measured on synthesized speech: ~1.7% of one core at 48 kHz input,
//   a hit 0.2-0.5 s after the name ends; see wake-keyword-detector.ts for hit/false rates.
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
  ),
  'wake-keyword-spotter-ru': huggingFaceFiles(
    'csukuangfj/sherpa-onnx-streaming-zipformer-small-ru-vosk-int8-2025-08-16',
    '31fa603e4f31279c6e1f7600fed13dc4312663ab',
    [
      [
        'encoder.int8.onnx',
        26214060,
        'e0db705e94ec35d803b1df4f40cda23d064e1142977c80ab288430b109777a9d'
      ],
      ['decoder.onnx', 2093080, '89b3088a9e20e1ef7f2e85ce1a3478afe6a9c4ac57369cabcc4beb8e95328ea0'],
      [
        'joiner.int8.onnx',
        259417,
        'b55784b071ab7512eab4c7c44e4f5478284ef33c83562cc6a249b972515a31e5'
      ],
      ['tokens.txt', 6388, '93bbbc0bae6b78c0bbb743d4aa9fded3bb5ff3aac5f0200e3a769a5a05e0fdf6']
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
  },
  {
    id: 'wake-keyword-spotter-ru',
    label: 'Zipformer KWS (ru)',
    description: 'Слышит обращение («Джарвис», «Пятница») по звуку, а не по расшифровке.',
    downloadFiles: FOCUS_MODEL_DOWNLOAD_FILES['wake-keyword-spotter-ru'],
    sizeBytes: FOCUS_MODEL_DOWNLOAD_FILES['wake-keyword-spotter-ru'].reduce(
      (total, file) => total + file.sizeBytes,
      0
    ),
    modelFile: 'encoder.int8.onnx'
  }
]

export function getFocusModelManifest(id: FocusModelId): FocusModelManifest {
  const manifest = FOCUS_MODEL_CATALOG.find((m) => m.id === id)
  if (!manifest) {
    throw new Error(`Unknown focus model: ${id}`)
  }
  return manifest
}
