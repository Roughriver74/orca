// The Silero sidecar's lifecycle, split out of companion-tts-service.ts to stay under the
// repo's per-file line cap: spawn it once from the provisioned model files, and restart it
// when a model file lands after it spawned (the optional v5_6).
import sidecarScriptPath from '../../../../resources/companion/tts-sidecar.py?asset&asarUnpack'
import { getCompanionTtsPaths, readProvisionedModelPaths } from './companion-tts-provisioning'
import type {
  CompanionTtsSidecarConfig,
  CompanionTtsSidecarProcess
} from './companion-tts-sidecar-process'

export type SidecarFactory = (config: CompanionTtsSidecarConfig) => CompanionTtsSidecarProcess

export class CompanionTtsSileroSidecar {
  private sidecar: CompanionTtsSidecarProcess | null = null
  private sidecarReady: Promise<CompanionTtsSidecarProcess> | null = null

  constructor(
    private readonly userDataDir: string,
    private readonly factory: SidecarFactory
  ) {}

  /** The spawned sidecar, if any — for cancel/shutdown, which must never spawn one. */
  get current(): CompanionTtsSidecarProcess | null {
    return this.sidecar
  }

  /** Resolves provisioned model paths and the venv interpreter, then builds the sidecar once. */
  ensure(): Promise<CompanionTtsSidecarProcess> {
    if (this.sidecar) {
      return Promise.resolve(this.sidecar)
    }
    this.sidecarReady ??= (async () => {
      const paths = getCompanionTtsPaths(this.userDataDir)
      const { v5ModelPath, v3ModelPath, v56ModelPath } = await readProvisionedModelPaths(
        this.userDataDir
      )
      if (!v5ModelPath && !v3ModelPath && !v56ModelPath) {
        throw new Error('companion TTS has not been provisioned yet — enable it in settings first')
      }
      const sidecar = this.factory({
        pythonPath: paths.venvPythonPath,
        scriptPath: sidecarScriptPath,
        scriptArgs: [v5ModelPath ?? '-', v3ModelPath ?? '-', v56ModelPath ?? '-']
      })
      this.sidecar = sidecar
      return sidecar
    })()
    return this.sidecarReady
  }

  /** Shuts the sidecar down so the next ensure() re-reads the model files; true if one existed. */
  async restart(): Promise<boolean> {
    const previous = this.sidecarReady
    if (!previous) {
      return false
    }
    this.sidecar = null
    this.sidecarReady = null
    try {
      await (await previous).shutdown()
    } catch (error) {
      console.error('[companion] Silero sidecar shutdown before restart failed', error)
    }
    return true
  }
}
