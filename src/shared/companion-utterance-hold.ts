// Pure decision logic behind CompanionPanel's "don't answer mid-thought" hold: given each
// finalized STT chunk, decides whether to submit it to the brain now or hold it and wait
// for a continuation. Owns no timers itself — CompanionPanel schedules/cancels the actual
// grace-window setTimeout and calls onTimeout()/reset() at the right moments, which keeps
// this class a plain state machine a test can drive without React or fake timers.

import { isCompanionUtteranceDangling } from './companion-utterance-dangling'

export type CompanionUtteranceHoldAction =
  | { kind: 'submit'; text: string; level: number }
  | { kind: 'hold' }

export type CompanionHeldUtterance = { text: string; level: number }

export class CompanionUtteranceHold {
  private held: CompanionHeldUtterance | null = null

  get isHolding(): boolean {
    return this.held !== null
  }

  /** Appends `text` to anything already held, then decides whether the combined utterance
   *  still looks cut off. `level` is the louder of the two when a continuation is appended,
   *  matching the single peak-level wake mode's follow-up filter expects per utterance. */
  onFinal(text: string, level: number): CompanionUtteranceHoldAction {
    const combined = this.held !== null ? `${this.held.text} ${text}` : text
    const combinedLevel = Math.max(this.held?.level ?? 0, level)
    if (isCompanionUtteranceDangling(combined)) {
      this.held = { text: combined, level: combinedLevel }
      return { kind: 'hold' }
    }
    this.held = null
    return { kind: 'submit', text: combined, level: combinedLevel }
  }

  /** The grace window elapsed with no further speech — returns whatever was held (if
   *  anything) for the caller to submit as-is, and clears the hold. */
  onTimeout(): CompanionHeldUtterance | null {
    const held = this.held
    this.held = null
    return held
  }

  /** Drops any held text without submitting it — used when the conversation turn itself
   *  ends (panel closed/reset) so a stale fragment never outlives its turn. */
  reset(): void {
    this.held = null
  }
}
