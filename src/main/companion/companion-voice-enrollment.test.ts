import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addVoiceEnrollmentPhrase,
  clearVoiceEnrollment,
  getVoiceEnrollmentStatus,
  loadVoiceEnrollmentProfile,
  meanEmbedding,
  MAX_VOICE_ENROLLMENT_PHRASES
} from './companion-voice-enrollment'

let dir: string

function setup(): string {
  dir = mkdtempSync(join(tmpdir(), 'orca-voice-enrollment-'))
  return dir
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('companion-voice-enrollment', () => {
  it('reports not enrolled with no profile file', () => {
    const userDataDir = setup()
    expect(getVoiceEnrollmentStatus(userDataDir)).toEqual({
      enrolled: false,
      phraseCount: 0,
      updatedAt: null
    })
    expect(loadVoiceEnrollmentProfile(userDataDir)).toBeNull()
  })

  it('persists each added phrase and reports status', () => {
    const userDataDir = setup()
    addVoiceEnrollmentPhrase(userDataDir, [1, 2, 3])
    addVoiceEnrollmentPhrase(userDataDir, new Float32Array([4, 5, 6]))

    const status = getVoiceEnrollmentStatus(userDataDir)
    expect(status.enrolled).toBe(true)
    expect(status.phraseCount).toBe(2)
    expect(status.updatedAt).not.toBeNull()

    const profile = loadVoiceEnrollmentProfile(userDataDir)
    expect(profile?.phraseEmbeddings).toEqual([
      [1, 2, 3],
      [4, 5, 6]
    ])
  })

  it('refuses a phrase beyond the cap without clearing first', () => {
    const userDataDir = setup()
    for (let i = 0; i < MAX_VOICE_ENROLLMENT_PHRASES; i += 1) {
      addVoiceEnrollmentPhrase(userDataDir, [i])
    }
    expect(() => addVoiceEnrollmentPhrase(userDataDir, [99])).toThrow(/clear it first/)
  })

  it('clearVoiceEnrollment resets to not enrolled and allows a fresh recording', () => {
    const userDataDir = setup()
    addVoiceEnrollmentPhrase(userDataDir, [1, 1])
    clearVoiceEnrollment(userDataDir)

    expect(getVoiceEnrollmentStatus(userDataDir)).toEqual({
      enrolled: false,
      phraseCount: 0,
      updatedAt: null
    })

    addVoiceEnrollmentPhrase(userDataDir, [7, 7])
    expect(getVoiceEnrollmentStatus(userDataDir).phraseCount).toBe(1)
  })

  it('ignores a corrupt profile file instead of throwing', () => {
    const userDataDir = setup()
    addVoiceEnrollmentPhrase(userDataDir, [1])
    writeFileSync(join(userDataDir, 'voice-profile.json'), 'not json')

    expect(loadVoiceEnrollmentProfile(userDataDir)).toBeNull()
    expect(getVoiceEnrollmentStatus(userDataDir).enrolled).toBe(false)
  })

  it('meanEmbedding averages the enrolled phrases element-wise', () => {
    expect(
      meanEmbedding({
        phraseEmbeddings: [
          [1, 2, 3],
          [3, 2, 1],
          [2, 2, 2]
        ],
        updatedAt: Date.now()
      })
    ).toEqual([2, 2, 2])
  })

  it('meanEmbedding is an empty array for an empty profile', () => {
    expect(meanEmbedding({ phraseEmbeddings: [], updatedAt: Date.now() })).toEqual([])
  })
})
