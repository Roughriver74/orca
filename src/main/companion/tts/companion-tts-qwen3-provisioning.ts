// Provisions the optional Qwen3-TTS engine on demand (provider set to `qwen3`): its own
// venv with pinned mlx-audio (MLX needs Python ≥3.12 for the tested numpy; the Silero venv
// stays on 3.11 + torch, untouched) and the 8-bit CustomVoice model files from Hugging
// Face at a pinned revision, each checked against its sha256. Everything lives under
// userData/companion-tts/qwen3 and reuses the Silero provisioner's `uv` binary.
// A marker file written last makes "already provisioned" a cheap sync check, so speak()
// can decide per call whether Qwen3 is usable without hashing 3 GB.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { CompanionTtsProvisioningStatus } from '../../../shared/companion-types'
import { isCompanionQwen3TtsSupported } from '../../../shared/companion-tts-support'
import { ensureModel, ensureUvBinary, getCompanionTtsPaths } from './companion-tts-provisioning'

const PYTHON_VERSION = '3.12.15'
// ~110 MB of wheels (mlx-metal alone is 75 MB); PyPI measured at 0.1-0.3 MB/s on this
// network took 20 minutes, twice the Silero installer's budget.
const INSTALL_TIMEOUT_MS = 40 * 60_000
const MLX_AUDIO_VERSION = '0.6.1'
// The combination measured in the bakeoff (~/assistant/docs/tts-bakeoff-emotion.md).
const PINNED_PACKAGES = [`mlx-audio==${MLX_AUDIO_VERSION}`, 'transformers==5.20.2', 'numpy==2.5.4']
const MODEL_REPO = 'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'
const MODEL_REVISION = '41d3337e8b7f2843a75841595fc14e4b9a7a4b96'
const MODEL_FILES: readonly { path: string; bytes: number; sha256: string }[] = [
  {
    path: 'model.safetensors',
    bytes: 2_393_308_931,
    sha256: 'b696f4bf45f54497b6de758981e76f1410bd68af05a657477dee466b0202df1a'
  },
  {
    path: 'speech_tokenizer/model.safetensors',
    bytes: 682_293_092,
    sha256: '836b7b357f5ea43e889936a3709af68dfe3751881acefe4ecf0dbd30ba571258'
  },
  {
    path: 'vocab.json',
    bytes: 2_776_833,
    sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910'
  },
  {
    path: 'merges.txt',
    bytes: 1_671_839,
    sha256: '599bab54075088774b1733fde865d5bd747cbcc7a547c5bc12610e874e26f5e3'
  },
  {
    path: 'model.safetensors.index.json',
    bytes: 71_786,
    sha256: '2551ed02dc288b90cd6b7ec98652433f08ef2ae98fb3eda5248a4b9e5b47d08b'
  },
  {
    path: 'tokenizer_config.json',
    bytes: 7344,
    sha256: 'dc3c31c3bdaedd5016382bb3cbe07323026775ad51f5a4fb564505992ae4a670'
  },
  {
    path: 'config.json',
    bytes: 6058,
    sha256: '43f29f9ab55cf387bd2ce1d07e9d95a5ca8974fa2fda4e2b45c13ae64aad3bfa'
  },
  {
    path: 'generation_config.json',
    bytes: 245,
    sha256: 'f1b90b4513f3b34c62851049e2492d7b4c5940daf1276f89c82b8ef04127f3aa'
  },
  {
    path: 'preprocessor_config.json',
    bytes: 127,
    sha256: 'efdde1022ea9d76928bf7a9cd53139138f5ba2e466e837f08f6105ab1af1c119'
  },
  {
    path: 'speech_tokenizer/config.json',
    bytes: 2336,
    sha256: 'ee65bb901c876664ab8707c487157aa1a6ee57c65969b28fb5ec9dc211e68167'
  },
  {
    path: 'speech_tokenizer/configuration.json',
    bytes: 76,
    sha256: '6bc26d64eb5024b4d1dab5a52371958b429256d6c9d59787f1f5294a54e0cebd'
  },
  {
    path: 'speech_tokenizer/preprocessor_config.json',
    bytes: 234,
    sha256: 'fcb3805e597e786d4067706e602f6688524640f8d3396790e2e09b5942fcbdfb'
  }
]
const MODEL_BYTES_TOTAL = MODEL_FILES.reduce((total, file) => total + file.bytes, 0)
const READY_MARKER = `${MODEL_REPO}@${MODEL_REVISION} mlx-audio==${MLX_AUDIO_VERSION}`

const STAGE_UV_END = 0.02
const STAGE_VENV_END = 0.12

export type CompanionTtsQwen3Paths = {
  rootDir: string
  venvDir: string
  venvPythonPath: string
  modelDir: string
  readyMarkerPath: string
}

export function getCompanionTtsQwen3Paths(userDataDir: string): CompanionTtsQwen3Paths {
  const rootDir = join(getCompanionTtsPaths(userDataDir).rootDir, 'qwen3')
  const venvDir = join(rootDir, 'venv')
  return {
    rootDir,
    venvDir,
    venvPythonPath: join(venvDir, 'bin', 'python'),
    modelDir: join(rootDir, 'models', 'Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit'),
    readyMarkerPath: join(rootDir, 'ready.txt')
  }
}

/** Cheap enough to run on every speak(): the marker is written only after every file and
 *  the venv were verified, and names the pinned revision so a version bump re-provisions. */
export function isCompanionTtsQwen3Provisioned(userDataDir: string): boolean {
  if (!isCompanionQwen3TtsSupported(process.platform, process.arch)) {
    return false
  }
  const paths = getCompanionTtsQwen3Paths(userDataDir)
  try {
    return (
      readFileSync(paths.readyMarkerPath, 'utf8').trim() === READY_MARKER &&
      existsSync(paths.venvPythonPath)
    )
  } catch {
    return false
  }
}

async function venvHasPinnedMlxAudio(venvPythonPath: string): Promise<boolean> {
  if (!existsSync(venvPythonPath)) {
    return false
  }
  const result = await runProcess({
    program: venvPythonPath,
    args: ['-c', "import importlib.metadata as m, mlx_audio; print(m.version('mlx-audio'))"],
    timeoutMs: 30_000
  })
  return result.code === 0 && result.stdout.trim() === MLX_AUDIO_VERSION
}

async function ensureQwen3Venv(userDataDir: string, paths: CompanionTtsQwen3Paths): Promise<void> {
  if (await venvHasPinnedMlxAudio(paths.venvPythonPath)) {
    return
  }
  const { uvBinaryPath, rootDir } = getCompanionTtsPaths(userDataDir)
  await rm(paths.venvDir, { recursive: true, force: true })
  // Shared with the Silero venv so both interpreters live in one uv-managed directory.
  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: join(rootDir, 'python-install')
  }
  const venvResult = await runProcess({
    program: uvBinaryPath,
    args: ['venv', '--python', PYTHON_VERSION, paths.venvDir],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (venvResult.code !== 0) {
    throw new Error(`uv venv (Qwen3) failed: ${venvResult.stderr}`)
  }
  const installResult = await runProcess({
    program: uvBinaryPath,
    args: ['pip', 'install', '--python', paths.venvPythonPath, ...PINNED_PACKAGES],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (installResult.code !== 0) {
    throw new Error(`uv pip install (Qwen3) failed: ${installResult.stderr}`)
  }
  if (!(await venvHasPinnedMlxAudio(paths.venvPythonPath))) {
    throw new Error('Qwen3 venv provisioned but the mlx-audio import check failed')
  }
}

/** Idempotent; reports progress tagged `engine: 'qwen3'` and never touches the Silero install.
 *  Off Apple Silicon it resolves null without reporting or installing anything: Silero speaks. */
export async function provisionCompanionTtsQwen3(
  userDataDir: string,
  onStatus: (status: CompanionTtsProvisioningStatus) => void
): Promise<CompanionTtsQwen3Paths | null> {
  if (!isCompanionQwen3TtsSupported(process.platform, process.arch)) {
    return null
  }
  const report = (status: CompanionTtsProvisioningStatus): void =>
    onStatus({ ...status, engine: 'qwen3' })
  const paths = getCompanionTtsQwen3Paths(userDataDir)
  if (isCompanionTtsQwen3Provisioned(userDataDir)) {
    report({ status: 'ready', progress: 100 })
    return paths
  }
  const progress = (fraction: number): void =>
    report({ status: 'downloading', progress: Math.round(fraction * 100) })
  try {
    await mkdir(paths.rootDir, { recursive: true })
    progress(0)
    await ensureUvBinary(getCompanionTtsPaths(userDataDir), (fraction) =>
      progress(fraction * STAGE_UV_END)
    )
    await ensureQwen3Venv(userDataDir, paths)
    progress(STAGE_VENV_END)
    let doneBytes = 0
    for (const file of MODEL_FILES) {
      await ensureModel(
        `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file.path}`,
        join(paths.modelDir, file.path),
        file.sha256,
        file.bytes,
        (fraction) =>
          progress(
            STAGE_VENV_END +
              ((1 - STAGE_VENV_END) * (doneBytes + fraction * file.bytes)) / MODEL_BYTES_TOTAL
          )
      )
      doneBytes += file.bytes
    }
    await writeFile(paths.readyMarkerPath, READY_MARKER)
    report({ status: 'ready', progress: 100 })
    return paths
  } catch (error) {
    report({
      status: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}
