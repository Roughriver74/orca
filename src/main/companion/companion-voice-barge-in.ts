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
// Still loudness only: companion-voice-barge-in-gate.ts decides whether a trigger is speech.

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

export type CompanionVoiceBargeInVerdict = {
  /** This frame beat the echo-relative threshold (never during calibration). */
  aboveEcho: boolean
  /** The sustain was reached on this frame — true once until `reset` or `rearm`. */
  triggered: boolean
}

const CALIBRATING: CompanionVoiceBargeInVerdict = { aboveEcho: false, triggered: false }

export type CompanionVoiceBargeInDetector = {
  feed(frame: CompanionVoiceActivityFrame): CompanionVoiceBargeInVerdict
  /** Starts a fresh calibration — call when a new reply starts playing. */
  reset(): void
  /** Forgets a rejected trigger but keeps the calibration, so the next burst can trigger. */
  rearm(): void
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

  function feed(frame: CompanionVoiceActivityFrame): CompanionVoiceBargeInVerdict {
    const reference = trackPlaybackPeak(frame)
    elapsedMs += frame.durationMs

    if (elapsedMs <= tuning.calibrationMs) {
      if (reference >= MIN_REFERENCE_LEVEL) {
        const coupling = Math.min(tuning.maxEchoCoupling, frame.micLevel / reference)
        learnedCoupling = Math.max(learnedCoupling ?? 0, coupling)
      }
      return CALIBRATING
    }

    const coupling = learnedCoupling ?? tuning.fallbackEchoCoupling
    const threshold = Math.max(tuning.minMicLevel, tuning.echoMargin * coupling * reference)
    const aboveEcho = frame.micLevel > threshold
    if (triggered) {
      return { aboveEcho, triggered: false }
    }
    if (aboveEcho) {
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
      return { aboveEcho, triggered: true }
    }
    return { aboveEcho, triggered: false }
  }

  function rearm(): void {
    speechMs = 0
    gapMs = 0
    triggered = false
  }

  function reset(): void {
    rearm()
    elapsedMs = 0
    learnedCoupling = null
    playbackHistory = []
    playbackHistoryMs = 0
  }

  return { feed, reset, rearm }
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
  const frame: CompanionVoiceActivityFrame = {
    micLevel: Math.min(1, Math.max(0, micLevel)),
    playbackLevel: Math.min(1, Math.max(0, playbackLevel)),
    durationMs
  }
  // Why bytes, not a Float32Array: the preload sends `samples` as a Buffer (typed arrays can
  // be zeroed crossing contextBridge — see speech-bridge.ts). Bad audio only starves the VAD.
  const bytes = 'samples' in value ? value.samples : undefined
  const sampleRate = 'sampleRate' in value ? value.sampleRate : undefined
  if (
    bytes instanceof Uint8Array &&
    bytes.byteLength > 0 &&
    bytes.byteLength % 4 === 0 &&
    bytes.byteOffset % 4 === 0 &&
    typeof sampleRate === 'number' &&
    Number.isFinite(sampleRate) &&
    sampleRate >= 8000 &&
    sampleRate <= 192_000
  ) {
    frame.audio = {
      samples: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4),
      sampleRate
    }
  }
  return frame
}
