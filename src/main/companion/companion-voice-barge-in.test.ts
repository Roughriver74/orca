import { describe, expect, it } from 'vitest'
import {
  createCompanionVoiceBargeInDetector,
  parseCompanionVoiceActivityFrame,
  type CompanionVoiceActivityFrame
} from './companion-voice-barge-in'

const FRAME_MS = 50

function frame(micLevel: number, playbackLevel: number): CompanionVoiceActivityFrame {
  return { micLevel, playbackLevel, durationMs: FRAME_MS }
}

/** Feeds `durationMs` worth of identical frames; returns how many of them reported a barge-in. */
function feedFor(
  detector: ReturnType<typeof createCompanionVoiceBargeInDetector>,
  durationMs: number,
  micLevel: number,
  playbackLevel: number
): number {
  let triggers = 0
  for (let elapsed = 0; elapsed < durationMs; elapsed += FRAME_MS) {
    if (detector.feed(frame(micLevel, playbackLevel))) {
      triggers += 1
    }
  }
  return triggers
}

/** 600ms of Jarvis talking with the mic hearing its echo at 0.3× the output level. */
function calibrated(): ReturnType<typeof createCompanionVoiceBargeInDetector> {
  const detector = createCompanionVoiceBargeInDetector()
  feedFor(detector, 600, 0.06, 0.2)
  return detector
}

describe('createCompanionVoiceBargeInDetector', () => {
  it('never triggers during calibration, however loud the mic is', () => {
    const detector = createCompanionVoiceBargeInDetector()
    expect(feedFor(detector, 600, 0.9, 0.2)).toBe(0)
  })

  it('triggers once the user talks over the reply for the sustain window', () => {
    const detector = calibrated()
    expect(feedFor(detector, 250, 0.3, 0.2)).toBe(0)
    expect(detector.feed(frame(0.3, 0.2))).toBe(true)
  })

  it('fires exactly once until reset, then recalibrates', () => {
    const detector = calibrated()
    expect(feedFor(detector, 1000, 0.3, 0.2)).toBe(1)
    detector.reset()
    expect(feedFor(detector, 600, 0.3, 0.2)).toBe(0)
  })

  it('ignores its own echo even when the reply gets louder', () => {
    const detector = calibrated()
    expect(feedFor(detector, 2000, 0.12, 0.4)).toBe(0)
    expect(feedFor(detector, 2000, 0.15, 0.4)).toBe(0)
  })

  it('ignores the reverb tail right after the playback level drops', () => {
    const detector = calibrated()
    feedFor(detector, 200, 0.09, 0.3)
    expect(feedFor(detector, 300, 0.09, 0)).toBe(0)
  })

  it('ignores a cough shorter than the sustain window', () => {
    const detector = calibrated()
    expect(feedFor(detector, 200, 0.4, 0.2)).toBe(0)
    expect(feedFor(detector, 200, 0.03, 0.2)).toBe(0)
    expect(feedFor(detector, 200, 0.4, 0.2)).toBe(0)
  })

  it('keeps a speech burst alive across a short syllable gap', () => {
    const detector = calibrated()
    feedFor(detector, 200, 0.3, 0.2)
    feedFor(detector, 50, 0.05, 0.2)
    expect(feedFor(detector, 100, 0.3, 0.2)).toBe(1)
  })

  it('never treats room noise below the absolute floor as speech', () => {
    const detector = calibrated()
    expect(feedFor(detector, 2000, 0.015, 0)).toBe(0)
  })

  it('assumes echo as loud as the output when calibration saw no playback', () => {
    const detector = createCompanionVoiceBargeInDetector()
    feedFor(detector, 600, 0.01, 0)
    expect(feedFor(detector, 1000, 0.15, 0.2)).toBe(0)
    expect(feedFor(detector, 1000, 0.7, 0.2)).toBe(1)
  })

  it('caps the learned coupling so talking during calibration cannot disable detection', () => {
    const detector = createCompanionVoiceBargeInDetector()
    feedFor(detector, 600, 0.9, 0.05)
    expect(feedFor(detector, 1000, 0.5, 0.05)).toBe(1)
  })
})

describe('parseCompanionVoiceActivityFrame', () => {
  it('accepts a well-formed frame and clamps levels into 0..1', () => {
    expect(
      parseCompanionVoiceActivityFrame({ micLevel: 1.4, playbackLevel: -1, durationMs: 42 })
    ).toEqual({ micLevel: 1, playbackLevel: 0, durationMs: 42 })
  })

  it('rejects malformed frames', () => {
    expect(parseCompanionVoiceActivityFrame(null)).toBeNull()
    expect(
      parseCompanionVoiceActivityFrame({ micLevel: '0.1', playbackLevel: 0, durationMs: 40 })
    ).toBeNull()
    expect(
      parseCompanionVoiceActivityFrame({ micLevel: Number.NaN, playbackLevel: 0, durationMs: 40 })
    ).toBeNull()
    expect(
      parseCompanionVoiceActivityFrame({ micLevel: 0.1, playbackLevel: 0, durationMs: 0 })
    ).toBeNull()
    expect(
      parseCompanionVoiceActivityFrame({ micLevel: 0.1, playbackLevel: 0, durationMs: 5000 })
    ).toBeNull()
  })
})
