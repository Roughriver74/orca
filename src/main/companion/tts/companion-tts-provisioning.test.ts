import { describe, expect, it } from 'vitest'
import { getCompanionTtsPaths } from './companion-tts-provisioning'
import { isCompanionSileroTtsSupported } from '../../../shared/companion-tts-support'

describe('isCompanionSileroTtsSupported', () => {
  it('is true only on macOS arm64', () => {
    expect(isCompanionSileroTtsSupported('darwin', 'arm64')).toBe(true)
    expect(isCompanionSileroTtsSupported('darwin', 'x64')).toBe(false)
    expect(isCompanionSileroTtsSupported('linux', 'arm64')).toBe(false)
    expect(isCompanionSileroTtsSupported('win32', 'arm64')).toBe(false)
  })
})

describe('getCompanionTtsPaths', () => {
  it('lays every artifact out under <userData>/companion-tts', () => {
    const paths = getCompanionTtsPaths('/tmp/userData')
    expect(paths.rootDir).toBe('/tmp/userData/companion-tts')
    expect(paths.uvBinaryPath).toBe('/tmp/userData/companion-tts/uv/uv')
    expect(paths.venvDir).toBe('/tmp/userData/companion-tts/venv')
    expect(paths.venvPythonPath).toBe('/tmp/userData/companion-tts/venv/bin/python')
    expect(paths.v5ModelPath).toBe('/tmp/userData/companion-tts/models/v5_4_ru.pt')
    expect(paths.v3ModelPath).toBe('/tmp/userData/companion-tts/models/v3_1_ru.pt')
    expect(paths.v56ModelPath).toBe('/tmp/userData/companion-tts/models/v5_6_ru.pt')
  })
})
