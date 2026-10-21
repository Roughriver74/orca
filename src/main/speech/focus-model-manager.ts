import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { SpeechModelState, SpeechModelStatus } from '../../shared/speech-types'
import {
  FOCUS_MODEL_CATALOG,
  getFocusModelManifest,
  type FocusModelId,
  type FocusModelManifest
} from './focus-model-catalog'
import { SpeechModelDownloadTransport } from './speech-model-download-transport'
import {
  removeModelDownloadFiles,
  removeModelDownloadStaging
} from './speech-model-download-cleanup'
import { openElectronSpeechDownloadRequest } from '../host/electron-speech-services'

type DownloadHandle = { abort: () => void }
type ProgressCallback = (assetId: FocusModelId, progress: number) => void

/**
 * Downloads/validates the VAD, speaker-embedding, and denoiser models the voice-focus
 * feature needs. Mirrors ModelManager's download machinery (same retry/resume/sha256
 * transport) but keeps its own tiny catalog and userData subdirectory so these assets
 * never appear in the STT model picker (SPEECH_MODEL_CATALOG/ModelManager own that).
 */
export class FocusModelManager extends SpeechModelDownloadTransport {
  private assetsDir: string
  private activeDownloads = new Map<FocusModelId, DownloadHandle>()
  private assetStates = new Map<FocusModelId, SpeechModelState>()
  private progressCallbacks = new Set<ProgressCallback>()

  constructor(customAssetsDir?: string) {
    super(openElectronSpeechDownloadRequest)
    this.assetsDir = customAssetsDir || join(app.getPath('userData'), 'voice-focus-models')
    mkdirSync(this.assetsDir, { recursive: true })
  }

  setProgressCallback(cb: ProgressCallback): () => void {
    this.progressCallbacks.add(cb)
    return () => {
      this.progressCallbacks.delete(cb)
    }
  }

  getAssetDir(id: FocusModelId): string {
    return join(this.assetsDir, id)
  }

  getModelPath(id: FocusModelId): string {
    return join(this.getAssetDir(id), getFocusModelManifest(id).modelFile)
  }

  private validateFiles(manifest: FocusModelManifest, dir: string): boolean {
    return manifest.downloadFiles.every(({ name, sizeBytes }) => {
      try {
        return statSync(join(dir, name)).size === sizeBytes
      } catch {
        return false
      }
    })
  }

  getAssetState(id: FocusModelId): SpeechModelState {
    const cached = this.assetStates.get(id)
    if (cached && (cached.status === 'downloading' || cached.status === 'extracting')) {
      return cached
    }
    const manifest = getFocusModelManifest(id)
    const dir = this.getAssetDir(id)
    if (existsSync(dir) && this.validateFiles(manifest, dir)) {
      const state: SpeechModelState = { id, status: 'ready' }
      this.assetStates.set(id, state)
      return state
    }
    return { id, status: 'not-downloaded' }
  }

  getAllAssetStates(): SpeechModelState[] {
    return FOCUS_MODEL_CATALOG.map((manifest) => this.getAssetState(manifest.id))
  }

  isReady(id: FocusModelId): boolean {
    return this.getAssetState(id).status === 'ready'
  }

  private updateState(id: FocusModelId, status: SpeechModelStatus, progress?: number): void {
    const state: SpeechModelState = { id, status, progress }
    this.assetStates.set(id, state)
    for (const callback of this.progressCallbacks) {
      callback(id, progress ?? (status === 'ready' ? 1 : -1))
    }
  }

  async download(id: FocusModelId): Promise<void> {
    if (this.activeDownloads.has(id)) {
      return
    }
    const manifest = getFocusModelManifest(id)
    const dir = this.getAssetDir(id)
    if (existsSync(dir) && this.validateFiles(manifest, dir)) {
      this.updateState(id, 'ready')
      return
    }

    this.updateState(id, 'downloading', 0)
    const stagingDir = `${dir}.partial`
    rmSync(stagingDir, { recursive: true, force: true })
    mkdirSync(stagingDir, { recursive: true })

    let aborted = false
    const abortController = new AbortController()
    this.activeDownloads.set(id, {
      abort: () => {
        aborted = true
        abortController.abort()
      }
    })

    try {
      const totalBytes = manifest.downloadFiles.reduce((sum, f) => sum + f.sizeBytes, 0)
      let completedBytes = 0
      for (const file of manifest.downloadFiles) {
        const filePath = join(stagingDir, file.name)
        await this.downloadFileWithRetry(
          file.url,
          filePath,
          file.sizeBytes,
          id,
          () => aborted,
          abortController.signal,
          completedBytes,
          totalBytes
        )
        if (aborted) {
          return
        }
        await this.verifyFileSha256(filePath, file.sha256)
        completedBytes += file.sizeBytes
      }

      if (!this.validateFiles(manifest, stagingDir)) {
        throw new Error('Focus model files missing after download')
      }

      await rm(dir, { recursive: true, force: true })
      await rename(stagingDir, dir)
      this.updateState(id, 'ready')
    } catch (err) {
      if (!aborted) {
        console.error('[voiceFocus] Model download failed:', id, err)
        this.updateState(id, 'error')
      }
      removeModelDownloadFiles(dir, stagingDir, join(this.assetsDir, `${id}.tar.bz2`))
      if (!aborted) {
        throw err
      }
    } finally {
      this.activeDownloads.delete(id)
      removeModelDownloadStaging(stagingDir, join(this.assetsDir, `${id}.tar.bz2`))
    }
  }

  cancelDownload(id: FocusModelId): void {
    const handle = this.activeDownloads.get(id)
    if (handle) {
      handle.abort()
      this.updateState(id, 'not-downloaded')
    }
  }

  protected reportDownloadProgress(assetId: string, progress: number): void {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the base class only forwards IDs this subclass registered as FocusModelId via its own download() calls.
    this.updateState(assetId as FocusModelId, 'downloading', progress)
  }
}

let singleton: FocusModelManager | null = null

/** Process-wide instance, same lazy-singleton shape as getSpeechModelManager. */
export function getFocusModelManager(): FocusModelManager {
  singleton ??= new FocusModelManager()
  return singleton
}

// Test-only: lets tests inject a FocusModelManager pointed at a tmp dir.
export function setFocusModelManagerForTesting(manager: FocusModelManager | null): void {
  singleton = manager
}
