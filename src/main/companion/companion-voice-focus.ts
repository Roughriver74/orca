// Decides, per finalized VAD segment, whether the audio was the enrolled owner's voice —
// so wake listening never wakes on the TV, and a hotkey session does not keep answering a
// stranger (or the TV) talking over the owner's silence. Pure policy: the actual cosine
// similarity is computed here from embeddings the caller already has (vad-worker.ts
// computes the segment's embedding; companion-voice-enrollment.ts stores the owner's), so
// this module needs no native bindings and is fully unit-testable.

import type { CompanionVoiceFocusStrictness } from '../../shared/companion-types'

/** Cosine similarity in [-1, 1]; 1 = identical direction. Mirrors the metric sherpa-onnx's
 *  own SpeakerEmbeddingManager.verify() uses internally (normalized dot product), so these
 *  thresholds stay meaningful if the runtime path ever switches to the native manager. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) {
    return 0
  }
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }
  if (normA === 0 || normB === 0) {
    return 0
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Why these three values: calibrated against the 3D-Speaker CAM++ VoxCeleb-en model's
// typical same-speaker/different-speaker cosine-similarity gap for short (2-5s)
// utterances — see /Users/evgenijsikunov/assistant/voice-lab/focus/report.md for the
// measured same-speaker vs. different-speaker distributions this range targets:
// "low" tolerates more variation (phone-call-quality mic, head turned away) at the cost
// of occasionally letting a similar-sounding stranger through; "high" minimizes false
// accepts at the cost of occasionally dropping the owner's own voice when it's quieter or
// more distant than the enrollment recordings.
export const VOICE_FOCUS_STRICTNESS_THRESHOLDS: Record<CompanionVoiceFocusStrictness, number> = {
  low: 0.45,
  medium: 0.55,
  high: 0.65
}

export function strictnessToThreshold(strictness: CompanionVoiceFocusStrictness): number {
  return VOICE_FOCUS_STRICTNESS_THRESHOLDS[strictness]
}

export type VoiceFocusMode = 'wake' | 'hotkey'

export type VoiceFocusVerification = {
  /** False when no "Голос владельца" profile is enrolled — verification cannot run. */
  enrolled: boolean
  /** Null when not enrolled, or the segment carried no embedding (extraction failed). */
  similarity: number | null
}

export type VoiceFocusDecision =
  | { kind: 'pass' }
  | { kind: 'drop'; reason: 'no-match' | 'silent-owner' }

/**
 * Policy (see assignment point 3):
 *  - No enrolled profile: nothing to verify against — fail open, pass through unchanged
 *    (the wake-phrase gate / hotkey press is still the primary filter).
 *  - Wake mode: drop anything that does not match the enrolled voice — never wake on a
 *    TV or a stranger just because they said the wake phrase.
 *  - Hotkey mode: the session was explicitly opened by the owner, so accept by default;
 *    only drop a segment that is clearly not the owner while the owner has not recently
 *    been the one talking (ownerRecentlyActive) — a TV getting loud mid-session should
 *    not hijack the conversation, but a borderline/noisy read of the owner's own voice
 *    must not be dropped just because the match is imperfect.
 */
export function decideVoiceFocus(args: {
  mode: VoiceFocusMode
  verification: VoiceFocusVerification
  threshold: number
  ownerRecentlyActive: boolean
}): VoiceFocusDecision {
  const { mode, verification, threshold, ownerRecentlyActive } = args
  if (!verification.enrolled || verification.similarity === null) {
    return { kind: 'pass' }
  }
  const matches = verification.similarity >= threshold
  if (matches) {
    return { kind: 'pass' }
  }
  if (mode === 'wake') {
    return { kind: 'drop', reason: 'no-match' }
  }
  // hotkey mode
  if (ownerRecentlyActive) {
    return { kind: 'pass' }
  }
  return { kind: 'drop', reason: 'silent-owner' }
}
