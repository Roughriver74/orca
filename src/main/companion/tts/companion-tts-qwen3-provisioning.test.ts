import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runProcess = vi.fn()
vi.mock('@orca/process-host', () => ({
  runProcess: (...args: unknown[]) => runProcess(...args)
}))

import {
  getCompanionTtsQwen3Paths,
  isCompanionTtsQwen3Provisioned,
  provisionCompanionTtsQwen3
} from './companion-tts-qwen3-provisioning'

const realPlatform = process.platform
const realArch = process.arch

function onHost(platform: string, arch: string): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true
  })
  Object.defineProperty(process, 'arch', { value: arch, configurable: true })
}

/** A userData whose Qwen3 install looks complete: marker for the pinned revision + venv python. */
function provisionedUserData(): string {
  const userDataDir = mkdtempSync(join(tmpdir(), 'qwen3-prov-'))
  const paths = getCompanionTtsQwen3Paths(userDataDir)
  mkdirSync(join(paths.venvDir, 'bin'), { recursive: true })
  writeFileSync(paths.venvPythonPath, '')
  writeFileSync(
    paths.readyMarkerPath,
    'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit@41d3337e8b7f2843a75841595fc14e4b9a7a4b96 mlx-audio==0.6.1'
  )
  return userDataDir
}

describe('Qwen3 provisioning off Apple Silicon', () => {
  let userDataDir: string

  beforeEach(() => {
    userDataDir = provisionedUserData()
  })

  afterEach(() => {
    onHost(realPlatform, realArch)
    rmSync(userDataDir, { recursive: true, force: true })
    runProcess.mockReset()
  })

  it.each([
    ['linux', 'x64'],
    ['linux', 'arm64'],
    ['darwin', 'x64'],
    ['win32', 'x64']
  ])(
    'on %s/%s installs nothing, reports nothing and never counts as provisioned',
    async (platform, arch) => {
      onHost(platform, arch)
      const onStatus = vi.fn()

      await expect(provisionCompanionTtsQwen3(userDataDir, onStatus)).resolves.toBeNull()

      expect(onStatus).not.toHaveBeenCalled()
      expect(runProcess).not.toHaveBeenCalled()
      expect(isCompanionTtsQwen3Provisioned(userDataDir)).toBe(false)
    }
  )

  it('on darwin/arm64 the same install counts as provisioned', async () => {
    onHost('darwin', 'arm64')
    const onStatus = vi.fn()

    expect(isCompanionTtsQwen3Provisioned(userDataDir)).toBe(true)
    await provisionCompanionTtsQwen3(userDataDir, onStatus)
    expect(onStatus).toHaveBeenCalledWith({
      status: 'ready',
      progress: 100,
      engine: 'qwen3'
    })
  })
})
