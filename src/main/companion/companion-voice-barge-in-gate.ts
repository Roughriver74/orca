// Turns the echo-margin detector's "something is loud over Jarvis" into what the reply does.
// Loudness alone fires on a notification chime or a TV — worst in a pause between phrases,
// where no playback means the threshold drops to its floor. So with confirmation on, a
// trigger first ducks the reply and becomes a barge-in only once Silero VAD has heard
// `minVoicedMs` of speech above the echo (counted back to the start of the burst, so a
// clear "стоп" interrupts on the trigger frame); if `windowMs` passes without that, the
// volume comes back and the detector re-arms.

import type {
  CompanionVoiceActivityFrame,
  CompanionVoiceBargeInConfirmSettings
} from '../../shared/companion-types'
import { createCompanionVoiceBargeInDetector } from './companion-voice-barge-in'

/** The VAD behind confirmation; companion-barge-in-vad.ts in production. */
export type CompanionBargeInSpeechSource = {
  feed(samples: Float32Array, sampleRate: number): void
  /** Latest verdict on the audio fed so far; null while no VAD runs (model missing, starting,
   *  failed) — confirmation then falls back to the sound outlasting the trigger. */
  isSpeech(): boolean | null
  /** A new reply: a verdict left over from the previous one must not count. */
  reset(): void
}

export type CompanionVoiceBargeInGateMode = {
  /** Sound never barges in in wake mode — see `isWakeModeActive` in companion-dialogue-contract.ts. */
  wakeMode: boolean
  confirm: CompanionVoiceBargeInConfirmSettings
}

/** `ducked`: a trigger is being confirmed — the panel plays the reply quieter meanwhile. */
export type CompanionVoiceBargeInGateVerdict = 'none' | 'ducked' | 'barge-in'

export type CompanionVoiceBargeInGate = {
  feed(frame: CompanionVoiceActivityFrame, mode: CompanionVoiceBargeInGateMode): CompanionVoiceBargeInGateVerdict
  /** A new reply started playing: recalibrate and forget every confirmation. */
  reset(): void
  /** Mic speech beat the echo this reply (see `hasConfirmedRealSpeech` in the dialogue contract). */
  hasConfirmedRealSpeech(): boolean
}

// Covers the detector's 300ms sustain plus a VAD verdict lagging a frame behind.
const VOICED_LOOKBACK_MS = 1000
// After a rejected trigger, sound that keeps going (a vacuum cleaner, music) would duck the
// reply again every sustain; until the mic is this quiet, only VAD-voiced sound may.
const QUIET_BEFORE_NEXT_DUCK_MS = 300

export function createCompanionVoiceBargeInGate(
  speech: CompanionBargeInSpeechSource
): CompanionVoiceBargeInGate {
  const detector = createCompanionVoiceBargeInDetector()
  let realSpeechConfirmed = false
  let pendingMs: number | null = null
  let loudSinceTriggerMs = 0
  let voicedHistory: { voiced: boolean; durationMs: number }[] = []
  let quietMs = 0
  let rejectedSound = false

  function voicedMs(frame: CompanionVoiceActivityFrame, voiced: boolean): number {
    voicedHistory.push({ voiced, durationMs: frame.durationMs })
    let total = 0
    let spanMs = 0
    for (let index = voicedHistory.length - 1; index >= 0; index -= 1) {
      if (spanMs >= VOICED_LOOKBACK_MS) {
        voicedHistory = voicedHistory.slice(index + 1)
        break
      }
      const entry = voicedHistory[index]
      spanMs += entry.durationMs
      total += entry.voiced ? entry.durationMs : 0
    }
    return total
  }

  function feed(
    frame: CompanionVoiceActivityFrame,
    mode: CompanionVoiceBargeInGateMode
  ): CompanionVoiceBargeInGateVerdict {
    const confirming = mode.confirm.enabled && !mode.wakeMode
    if (confirming && frame.audio) {
      speech.feed(frame.audio.samples, frame.audio.sampleRate)
    }
    const { aboveEcho, triggered } = detector.feed(frame)
    if (!confirming) {
      if (!triggered) {
        return 'none'
      }
      realSpeechConfirmed = true
      return mode.wakeMode ? 'none' : 'barge-in'
    }

    const isSpeech = speech.isSpeech()
    const voiced = voicedMs(frame, aboveEcho && isSpeech === true)
    quietMs = aboveEcho ? 0 : quietMs + frame.durationMs
    if (quietMs >= QUIET_BEFORE_NEXT_DUCK_MS) {
      rejectedSound = false
    }

    if (pendingMs === null) {
      if (!triggered) {
        return 'none'
      }
      if (rejectedSound && isSpeech !== true) {
        detector.rearm()
        return 'none'
      }
      pendingMs = 0
      loudSinceTriggerMs = 0
    } else {
      pendingMs += frame.durationMs
      loudSinceTriggerMs += aboveEcho ? frame.durationMs : 0
    }

    const confirmed =
      isSpeech === null
        ? loudSinceTriggerMs >= mode.confirm.minVoicedMs
        : voiced >= mode.confirm.minVoicedMs
    if (confirmed) {
      pendingMs = null
      realSpeechConfirmed = true
      return 'barge-in'
    }
    if (pendingMs >= mode.confirm.windowMs) {
      pendingMs = null
      rejectedSound = true
      voicedHistory = []
      detector.rearm()
      return 'none'
    }
    return 'ducked'
  }

  function reset(): void {
    detector.reset()
    speech.reset()
    realSpeechConfirmed = false
    pendingMs = null
    voicedHistory = []
    quietMs = 0
    rejectedSound = false
  }

  return { feed, reset, hasConfirmedRealSpeech: () => realSpeechConfirmed }
}
