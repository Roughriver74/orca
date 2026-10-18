import { describe, expect, it } from 'vitest'
import { getCompanionTtsPaths, isCompanionTtsSupported } from './companion-tts-provisioning'

describe('isCompanionTtsSupported', () => {
  it('is true only on macOS arm64', () => {
    expect(isCompanionTtsSupported('darwin', 'arm64')).toBe(true)
    expect(isCompanionTtsSupported('darwin', 'x64')).toBe(false)
    expect(isCompanionTtsSupported('linux', 'arm64')).toBe(false)
    expect(isCompanionTtsSupported('win32', 'arm64')).toBe(false)
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
  })
})
