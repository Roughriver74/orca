import { describe, expect, it } from 'vitest'
import {
  cosineSimilarity,
  decideVoiceFocus,
  strictnessToThreshold,
  VOICE_FOCUS_STRICTNESS_THRESHOLDS
} from './companion-voice-focus'

describe('cosineSimilarity', () => {
  it('is 1 for identical direction vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 5)
  })

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5)
  })

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 1], [-1, -1])).toBeCloseTo(-1, 5)
  })

  it('is 0 for mismatched lengths or empty vectors (fails safe, never throws)', () => {
    expect(cosineSimilarity([1, 2], [1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })

  it('is 0 when either vector is all zeros (undefined direction)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('strictnessToThreshold', () => {
  it('increases monotonically from low to high', () => {
    expect(strictnessToThreshold('low')).toBeLessThan(strictnessToThreshold('medium'))
    expect(strictnessToThreshold('medium')).toBeLessThan(strictnessToThreshold('high'))
  })

  it('matches the exported threshold table', () => {
    expect(strictnessToThreshold('medium')).toBe(VOICE_FOCUS_STRICTNESS_THRESHOLDS.medium)
  })
})

describe('decideVoiceFocus', () => {
  const threshold = 0.55

  it('passes everything when no profile is enrolled (fail open)', () => {
    expect(
      decideVoiceFocus({
        mode: 'wake',
        verification: { enrolled: false, similarity: null },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'pass' })
  })

  it('passes a matching segment in wake mode', () => {
    expect(
      decideVoiceFocus({
        mode: 'wake',
        verification: { enrolled: true, similarity: 0.8 },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'pass' })
  })

  it('drops a non-matching segment in wake mode — never wakes on the TV', () => {
    expect(
      decideVoiceFocus({
        mode: 'wake',
        verification: { enrolled: true, similarity: 0.1 },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'drop', reason: 'no-match' })
  })

  it('passes a non-matching segment in hotkey mode when the owner was recently active', () => {
    expect(
      decideVoiceFocus({
        mode: 'hotkey',
        verification: { enrolled: true, similarity: 0.1 },
        threshold,
        ownerRecentlyActive: true
      })
    ).toEqual({ kind: 'pass' })
  })

  it('drops a non-matching segment in hotkey mode while the owner has been silent', () => {
    expect(
      decideVoiceFocus({
        mode: 'hotkey',
        verification: { enrolled: true, similarity: 0.1 },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'drop', reason: 'silent-owner' })
  })

  it('treats a missing embedding (extraction failure) as unverifiable — pass through', () => {
    expect(
      decideVoiceFocus({
        mode: 'wake',
        verification: { enrolled: true, similarity: null },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'pass' })
  })

  it('treats similarity exactly at threshold as a match', () => {
    expect(
      decideVoiceFocus({
        mode: 'wake',
        verification: { enrolled: true, similarity: threshold },
        threshold,
        ownerRecentlyActive: false
      })
    ).toEqual({ kind: 'pass' })
  })
})
