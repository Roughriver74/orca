// Provisions everything the companion TTS sidecar needs on first enable: a pinned
// standalone `uv` binary, a venv with pinned CPU torch/numpy uv creates from it, and
// the required Silero model files (v5_4 + v3_1); the optional v5_6 model downloads
// separately via ensureCompanionTtsSileroV56. Everything lands
// under userData so a plain install on a second machine works with no sudo, no Homebrew, and no system Python dependency —
// matching how STT model downloads already behave (see ../../speech/model-manager.ts).
// Idempotent: every step checks its artifact before touching the network again, so a
// second call after a successful provision does no I/O beyond a few stat/hash checks.

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { get as httpsGet } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { runProcess } from '@orca/process-host'
import type { CompanionTtsProvisioningStatus } from '../../../shared/companion-types'
import { isCompanionSileroTtsSupported } from '../../../shared/companion-tts-support'

// Why pinned to an exact release + hash rather than "latest": a provisioning step that
// silently picks up a new uv/torch/model build on every user's first enable is not
// reproducible and cannot be rolled back by a version bump in this repo alone.
const UV_VERSION = '0.12.24'
const UV_DARWIN_ARM64_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`
const UV_DARWIN_ARM64_SHA256 = '0c4346de7abdb49495b393b9ec809fe387aa43e586be20fecb972216c1e71732'
const PYTHON_VERSION = '3.11.15'
const TORCH_VERSION = '2.14.1'
const NUMPY_VERSION = '2.4.6'

const SILERO_V5_MODEL_URL = 'https://models.silero.ai/models/tts/ru/v5_4_ru.pt'
const SILERO_V5_MODEL_SHA256 = '10642dda88b3e2dd1685bf974253447bcf3c95333213d3e34f516ceab85580cc'
const SILERO_V5_MODEL_BYTES = 145_412_956
const SILERO_V3_MODEL_URL = 'https://models.silero.ai/models/tts/ru/v3_1_ru.pt'
const SILERO_V3_MODEL_SHA256 = 'cf60b47ec8a9c31046021d2d14b962ea56b8a5bf7061c98accaaaca428522f85'
const SILERO_V3_MODEL_BYTES = 61_896_251
const SILERO_V56_MODEL_URL = 'https://models.silero.ai/models/tts/ru/v5_6_ru.pt'
const SILERO_V56_MODEL_SHA256 = '04cc9b1d08ce38bcaa9d02c488d80d3e6806d17f7eaa7c95982f36a3cbf50b2e'
const SILERO_V56_MODEL_BYTES = 147_664_410

const INSTALL_TIMEOUT_MS = 10 * 60_000

export type CompanionTtsPaths = {
  rootDir: string
  uvBinaryPath: string
  venvDir: string
  venvPythonPath: string
  v5ModelPath: string
  v3ModelPath: string
  v56ModelPath: string
}

export function getCompanionTtsPaths(userDataDir: string): CompanionTtsPaths {
  const rootDir = join(userDataDir, 'companion-tts')
  const venvDir = join(rootDir, 'venv')
  return {
    rootDir,
    uvBinaryPath: join(rootDir, 'uv', 'uv'),
    venvDir,
    venvPythonPath: join(venvDir, 'bin', 'python'),
    v5ModelPath: join(rootDir, 'models', 'v5_4_ru.pt'),
    v3ModelPath: join(rootDir, 'models', 'v3_1_ru.pt'),
    v56ModelPath: join(rootDir, 'models', 'v5_6_ru.pt')
  }
}

async function sha256OfFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function fileMatchesHash(path: string, expectedSha256: string): Promise<boolean> {
  if (!existsSync(path)) {
    return false
  }
  try {
    return (await sha256OfFile(path)) === expectedSha256
  } catch {
    return false
  }
}

/** Follows redirects to the final 200 response, without touching the filesystem — kept
 *  separate from the write so only one caller in the recursion chain ever renames the
 *  temp file (a shared trailing rename after `await` on a redirecting recursive call
 *  would otherwise fire a second time on an already-renamed, now-missing temp path). */
async function fetchFollowingRedirects(url: string, redirectsLeft = 5): Promise<IncomingMessage> {
  return new Promise<IncomingMessage>((resolve, reject) => {
    httpsGet(url, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location && redirectsLeft > 0) {
        response.resume()
        // Hugging Face answers small files with a host-relative Location.
        const next = new URL(response.headers.location, url).toString()
        fetchFollowingRedirects(next, redirectsLeft - 1).then(resolve, reject)
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`download failed: ${url} responded ${status}`))
        return
      }
      resolve(response)
    }).on('error', reject)
  })
}

/** Downloads with redirect following and a streaming progress callback, via a temp file + atomic rename. */
async function downloadWithProgress(
  url: string,
  destPath: string,
  onBytes: (downloaded: number, total: number) => void,
  redirectsLeft = 5
): Promise<void> {
  await mkdir(join(destPath, '..'), { recursive: true })
  const tempPath = `${destPath}.download`
  const response = await fetchFollowingRedirects(url, redirectsLeft)
  const total = Number(response.headers['content-length'] ?? 0)
  let downloaded = 0
  response.on('data', (chunk: Buffer) => {
    downloaded += chunk.length
    onBytes(downloaded, total)
  })
  await pipeline(response, createWriteStream(tempPath))
  await rename(tempPath, destPath)
}

/** Resolves true when it downloaded the file, false when a matching copy was already there. */
export async function ensureModel(
  url: string,
  path: string,
  sha256: string,
  totalBytes: number,
  onProgress: (fraction: number) => void
): Promise<boolean> {
  if (await fileMatchesHash(path, sha256)) {
    onProgress(1)
    return false
  }
  await downloadWithProgress(url, path, (downloaded) => onProgress(downloaded / totalBytes))
  if (!(await fileMatchesHash(path, sha256))) {
    await rm(path, { force: true })
    throw new Error(`downloaded model at ${path} does not match the pinned sha256`)
  }
  return true
}

export async function ensureUvBinary(
  paths: CompanionTtsPaths,
  onProgress: (fraction: number) => void
): Promise<void> {
  if (existsSync(paths.uvBinaryPath)) {
    onProgress(1)
    return
  }
  const tarballPath = join(paths.rootDir, 'uv', 'uv.tar.gz')
  await downloadWithProgress(UV_DARWIN_ARM64_URL, tarballPath, () => onProgress(0.5))
  const tarballSha256 = await sha256OfFile(tarballPath)
  if (tarballSha256 !== UV_DARWIN_ARM64_SHA256) {
    await rm(tarballPath, { force: true })
    throw new Error('downloaded uv tarball does not match the pinned sha256')
  }
  const extractResult = await runProcess({
    program: '/usr/bin/tar',
    // --strip-components=1: astral-sh's release tarball wraps the uv/uvx binaries in a
    // top-level `uv-aarch64-apple-darwin/` directory; paths.uvBinaryPath expects them
    // directly under `uv/`.
    args: ['-xzf', tarballPath, '--strip-components=1', '-C', join(paths.rootDir, 'uv')],
    timeoutMs: 60_000
  })
  if (extractResult.code !== 0) {
    throw new Error(`failed to extract uv: ${extractResult.stderr}`)
  }
  await chmod(paths.uvBinaryPath, 0o755)
  await rm(tarballPath, { force: true })
  onProgress(1)
}

/** True once the venv's python can import torch at the pinned version — the one check that
 *  proves a previous `uv pip install` actually completed, not just that the directory exists. */
async function venvHasPinnedTorch(venvPythonPath: string): Promise<boolean> {
  if (!existsSync(venvPythonPath)) {
    return false
  }
  const result = await runProcess({
    program: venvPythonPath,
    args: ['-c', 'import torch; print(torch.__version__)'],
    timeoutMs: 15_000
  })
  return result.code === 0 && result.stdout.trim().startsWith(TORCH_VERSION)
}

async function ensureVenv(paths: CompanionTtsPaths): Promise<void> {
  if (await venvHasPinnedTorch(paths.venvPythonPath)) {
    return
  }
  await rm(paths.venvDir, { recursive: true, force: true })
  const pythonInstallDir = join(paths.rootDir, 'python-install')
  await mkdir(pythonInstallDir, { recursive: true })
  const env = { ...process.env, UV_PYTHON_INSTALL_DIR: pythonInstallDir }

  const venvResult = await runProcess({
    program: paths.uvBinaryPath,
    args: ['venv', '--python', PYTHON_VERSION, paths.venvDir],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (venvResult.code !== 0) {
    throw new Error(`uv venv failed: ${venvResult.stderr}`)
  }

  const installResult = await runProcess({
    program: paths.uvBinaryPath,
    args: [
      'pip',
      'install',
      '--python',
      paths.venvPythonPath,
      `torch==${TORCH_VERSION}`,
      `numpy==${NUMPY_VERSION}`
    ],
    env,
    timeoutMs: INSTALL_TIMEOUT_MS
  })
  if (installResult.code !== 0) {
    throw new Error(`uv pip install failed: ${installResult.stderr}`)
  }
  if (!(await venvHasPinnedTorch(paths.venvPythonPath))) {
    throw new Error('venv provisioned but torch import check failed')
  }
}

// Weighted stage split for the combined 0-100 progress reported to settings: uv binary is
// small and fast, the venv+pip install dominates wall time but has no byte-level progress
// to report, and the models are weighted by their actual download size.
const STAGE_UV_END = 0.05
const STAGE_VENV_END = 0.4
const MODEL_BYTES_TOTAL = SILERO_V5_MODEL_BYTES + SILERO_V3_MODEL_BYTES
const STAGE_V5_END = STAGE_VENV_END + (0.6 * SILERO_V5_MODEL_BYTES) / MODEL_BYTES_TOTAL
const STAGE_V3_END = 1

export async function provisionCompanionTts(
  userDataDir: string,
  onStatus: (status: CompanionTtsProvisioningStatus) => void
): Promise<CompanionTtsPaths> {
  if (!isCompanionSileroTtsSupported(process.platform, process.arch)) {
    const status: CompanionTtsProvisioningStatus = {
      status: 'error',
      error: `companion TTS is only supported on macOS arm64 (this host is ${process.platform}/${process.arch})`
    }
    onStatus(status)
    throw new Error(status.error)
  }

  const paths = getCompanionTtsPaths(userDataDir)
  await mkdir(paths.rootDir, { recursive: true })
  onStatus({ status: 'downloading', progress: 0 })

  try {
    await ensureUvBinary(paths, (fraction) =>
      onStatus({ status: 'downloading', progress: Math.round(fraction * STAGE_UV_END * 100) })
    )
    onStatus({ status: 'downloading', progress: Math.round(STAGE_UV_END * 100) })

    await ensureVenv(paths)
    onStatus({ status: 'downloading', progress: Math.round(STAGE_VENV_END * 100) })

    await ensureModel(
      SILERO_V5_MODEL_URL,
      paths.v5ModelPath,
      SILERO_V5_MODEL_SHA256,
      SILERO_V5_MODEL_BYTES,
      (fraction) =>
        onStatus({
          status: 'downloading',
          progress: Math.round((STAGE_VENV_END + fraction * (STAGE_V5_END - STAGE_VENV_END)) * 100)
        })
    )

    await ensureModel(
      SILERO_V3_MODEL_URL,
      paths.v3ModelPath,
      SILERO_V3_MODEL_SHA256,
      SILERO_V3_MODEL_BYTES,
      (fraction) =>
        onStatus({
          status: 'downloading',
          progress: Math.round((STAGE_V5_END + fraction * (STAGE_V3_END - STAGE_V5_END)) * 100)
        })
    )

    onStatus({ status: 'ready', progress: 100 })
    return paths
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    onStatus({ status: 'error', error: message })
    throw error
  }
}

/** Fetches the optional Silero v5_6 model after the required install is ready, with no
 *  settings status: Silero already speaks on v5_4/v3_1, and models.silero.ai can serve this
 *  file at ~30 KB/s or answer 502 for hours. True only when this call downloaded it, so the
 *  caller restarts a sidecar that started without it. */
export async function ensureCompanionTtsSileroV56(userDataDir: string): Promise<boolean> {
  if (!isCompanionSileroTtsSupported(process.platform, process.arch)) {
    return false
  }
  return ensureModel(
    SILERO_V56_MODEL_URL,
    getCompanionTtsPaths(userDataDir).v56ModelPath,
    SILERO_V56_MODEL_SHA256,
    SILERO_V56_MODEL_BYTES,
    () => undefined
  )
}

/** Reports readiness without doing any provisioning work, for a settings-pane status row on open. */
export async function getCompanionTtsProvisioningStatus(
  userDataDir: string
): Promise<CompanionTtsProvisioningStatus> {
  if (!isCompanionSileroTtsSupported(process.platform, process.arch)) {
    return { status: 'error', error: 'companion TTS is only supported on macOS arm64' }
  }
  const paths = getCompanionTtsPaths(userDataDir)
  const [uvReady, venvReady, v5Ready, v3Ready] = await Promise.all([
    Promise.resolve(existsSync(paths.uvBinaryPath)),
    venvHasPinnedTorch(paths.venvPythonPath),
    fileMatchesHash(paths.v5ModelPath, SILERO_V5_MODEL_SHA256),
    fileMatchesHash(paths.v3ModelPath, SILERO_V3_MODEL_SHA256)
  ])
  if (uvReady && venvReady && v5Ready && v3Ready) {
    return { status: 'ready', progress: 100 }
  }
  return { status: 'idle' }
}

/** Reads back the pinned model paths without provisioning, for the sidecar config once ready. */
export async function readProvisionedModelPaths(userDataDir: string): Promise<{
  v5ModelPath: string | null
  v3ModelPath: string | null
  v56ModelPath: string | null
}> {
  const paths = getCompanionTtsPaths(userDataDir)
  const [v5Ready, v3Ready, v56Ready] = await Promise.all([
    fileMatchesHash(paths.v5ModelPath, SILERO_V5_MODEL_SHA256),
    fileMatchesHash(paths.v3ModelPath, SILERO_V3_MODEL_SHA256),
    fileMatchesHash(paths.v56ModelPath, SILERO_V56_MODEL_SHA256)
  ])
  return {
    v5ModelPath: v5Ready ? paths.v5ModelPath : null,
    v3ModelPath: v3Ready ? paths.v3ModelPath : null,
    v56ModelPath: v56Ready ? paths.v56ModelPath : null
  }
}
