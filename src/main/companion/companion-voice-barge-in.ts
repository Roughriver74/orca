// Decides, from per-frame mic/playback levels the panel reports while a reply plays,
// whether the user is talking over Jarvis. The mic also hears Jarvis through the speakers,
// so loudness alone would make it interrupt itself. Three guards stack on top of the
// browser's own echo cancellation (requested on the mic stream, but not guaranteed to
// cover WebAudio output):
//   1. calibration — the first `calibrationMs` of each reply never trigger; they measure
//      how loud Jarvis's own voice comes back through the mic ("echo coupling");
//   2. echo-relative threshold — the mic must beat `echoMargin` × the echo predicted from
//      the recent playback peak (the window absorbs output latency and room reverb), and
//      an absolute floor so silence-level noise never counts;
//   3. sustain — speech must hold for `sustainMs`, so a cough or a click does not cut in.

import type { CompanionVoiceActivityFrame } from '../../shared/companion-types'

export type { CompanionVoiceActivityFrame } from '../../shared/companion-types'

export type CompanionVoiceBargeInTuning = {
  calibrationMs: number
  sustainMs: number
  /** Below-threshold dips shorter than this keep a speech burst alive (syllable gaps). */
  gapToleranceMs: number
  /** RMS floor: anything quieter is never user speech. */
  minMicLevel: number
  /** Mic must exceed the predicted echo by this factor (3 ≈ +9.5 dB). */
  echoMargin: number
  /** How far back the playback peak reaches when predicting the echo of "now". */
  echoWindowMs: number
  /** Coupling used when calibration saw no playback at all: assume echo as loud as output. */
  fallbackEchoCoupling: number
  /** Caps learned coupling so talking during calibration cannot switch detection off. */
  maxEchoCoupling: number
}

export const DEFAULT_COMPANION_VOICE_BARGE_IN_TUNING: CompanionVoiceBargeInTuning = {
  calibrationMs: 600,
  sustainMs: 300,
  gapToleranceMs: 90,
  minMicLevel: 0.02,
  echoMargin: 3,
  echoWindowMs: 400,
  fallbackEchoCoupling: 1,
  maxEchoCoupling: 1.5
}

// Playback quieter than this carries no usable echo reference for calibration.
const MIN_REFERENCE_LEVEL = 0.005

export type CompanionVoiceBargeInDetector = {
  /** Feeds one frame; true exactly once, when user speech is confirmed (until `reset`). */
  feed(frame: CompanionVoiceActivityFrame): boolean
  /** Starts a fresh calibration — call when a new reply starts playing. */
  reset(): void
}

export function createCompanionVoiceBargeInDetector(
  tuning: CompanionVoiceBargeInTuning = DEFAULT_COMPANION_VOICE_BARGE_IN_TUNING
): CompanionVoiceBargeInDetector {
  let elapsedMs = 0
  let learnedCoupling: number | null = null
  let speechMs = 0
  let gapMs = 0
  let triggered = false
  let playbackHistory: { level: number; durationMs: number }[] = []
  let playbackHistoryMs = 0

  /** Peak playback level over the last `echoWindowMs`, including this frame. */
  function trackPlaybackPeak(frame: CompanionVoiceActivityFrame): number {
    playbackHistory.push({ level: frame.playbackLevel, durationMs: frame.durationMs })
    playbackHistoryMs += frame.durationMs
    while (
      playbackHistory.length > 1 &&
      playbackHistoryMs - playbackHistory[0].durationMs >= tuning.echoWindowMs
    ) {
      playbackHistoryMs -= playbackHistory[0].durationMs
      playbackHistory.shift()
    }
    return Math.max(...playbackHistory.map((entry) => entry.level))
  }

  function feed(frame: CompanionVoiceActivityFrame): boolean {
    if (triggered) {
      return false
    }
    const reference = trackPlaybackPeak(frame)
    elapsedMs += frame.durationMs

    if (elapsedMs <= tuning.calibrationMs) {
      if (reference >= MIN_REFERENCE_LEVEL) {
        const coupling = Math.min(tuning.maxEchoCoupling, frame.micLevel / reference)
        learnedCoupling = Math.max(learnedCoupling ?? 0, coupling)
      }
      return false
    }

    const coupling = learnedCoupling ?? tuning.fallbackEchoCoupling
    const threshold = Math.max(tuning.minMicLevel, tuning.echoMargin * coupling * reference)
    if (frame.micLevel > threshold) {
      speechMs += frame.durationMs
      gapMs = 0
    } else {
      gapMs += frame.durationMs
      if (gapMs > tuning.gapToleranceMs) {
        speechMs = 0
        gapMs = 0
      }
    }
    if (speechMs >= tuning.sustainMs) {
      triggered = true
      return true
    }
    return false
  }

  function reset(): void {
    elapsedMs = 0
    learnedCoupling = null
    speechMs = 0
    gapMs = 0
    triggered = false
    playbackHistory = []
    playbackHistoryMs = 0
  }

  return { feed, reset }
}

/** Guards the IPC boundary: a frame the panel could not have produced is dropped, not trusted. */
export function parseCompanionVoiceActivityFrame(
  value: unknown
): CompanionVoiceActivityFrame | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const micLevel = 'micLevel' in value ? value.micLevel : undefined
  const playbackLevel = 'playbackLevel' in value ? value.playbackLevel : undefined
  const durationMs = 'durationMs' in value ? value.durationMs : undefined
  if (
    typeof micLevel !== 'number' ||
    typeof playbackLevel !== 'number' ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(micLevel) ||
    !Number.isFinite(playbackLevel) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > 1000
  ) {
    return null
  }
  return {
    micLevel: Math.min(1, Math.max(0, micLevel)),
    playbackLevel: Math.min(1, Math.max(0, playbackLevel)),
    durationMs
  }
}
