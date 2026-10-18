import { useCallback, useMemo, useRef, useState } from 'react'
import { CompanionUtteranceHold } from '../../../../shared/companion-utterance-hold'

// Extra silence tolerated after a clearly cut-off utterance ("...и,", "...чтобы") before
// giving up and submitting it as-is. Purely a panel-local hold on when to call
// reportUtterance — wake-phrase gating and barge-in never see it.
const DANGLING_HOLD_GRACE_MS = 3000

export type CompanionUtteranceHoldWiringDeps = {
  /** Submits one combined utterance to the brain (via reportUtterance), same as always. */
  appendUserTurn: (text: string) => void
  stopListening: () => void
  /** The last VAD segment's speaker embedding (voice focus), consumed (cleared) on read
   *  — null when VAD segmentation was not active for this utterance. Read at submit
   *  time, not combine time: a dangling-utterance hold's final submit uses whichever
   *  segment most recently ended, which is the acoustically closest one anyway. */
  getPendingEmbedding: () => number[] | null
  /** Voice focus dropped this segment (not the owner's voice) — only called when the
   *  "показывать отброшенное" debug setting is on; renders a dim turn instead of a
   *  normal one. */
  onVoiceDropped: (text: string) => void
}

export type CompanionUtteranceHoldWiring = {
  /** True while a dangling utterance is held — the panel shows "…жду продолжения". */
  isHolding: boolean
  /** CompanionPanel assigns this every render (`hold.depsRef.current = {...}`) once
   *  appendUserTurn/stopListening exist — a plain ref sidesteps the circular declaration
   *  order those two callbacks would otherwise force on this hook's own call site. */
  depsRef: React.RefObject<CompanionUtteranceHoldWiringDeps | null>
  /** Call with each finalized STT chunk; combines/holds/submits per CompanionUtteranceHold. */
  handleFinalText: (text: string, level: number) => void
  /** Call from the mic meter callback whenever it reports `isSpeaking` — cancels any
   *  pending submit-as-is timeout so a resumed utterance isn't cut off mid-continuation. */
  cancelHoldOnSpeaking: () => void
  /** Drops any held text — call when the conversation turn itself ends (stop/reset). */
  clearHold: () => void
}

/** A finalized utterance that trails off mid-thought is held instead of sent to the
 *  brain — the panel shows "…жду продолжения" and waits up to DANGLING_HOLD_GRACE_MS for
 *  the user to keep talking. See CompanionUtteranceHold for the append/resubmit decision;
 *  silence past the grace window submits the held text as-is. Split out of
 *  CompanionPanel.tsx to keep that file under the repo's per-file line cap. */
export function useCompanionUtteranceHoldWiring(): CompanionUtteranceHoldWiring {
  const [isHolding, setIsHolding] = useState(false)
  const [hold] = useState(() => new CompanionUtteranceHold())
  const holdTimeoutRef = useRef<number | null>(null)
  const depsRef = useRef<CompanionUtteranceHoldWiringDeps | null>(null)

  const clearHold = useCallback((): void => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
    hold.reset()
    setIsHolding(false)
  }, [hold])

  const cancelHoldOnSpeaking = useCallback((): void => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
  }, [])

  const submitUtterance = useCallback(async (text: string, level: number): Promise<void> => {
    const embedding = depsRef.current?.getPendingEmbedding() ?? null
    const result = await window.api.companion.reportUtterance(text, { level, embedding })
    if (result.ignored) {
      if (result.droppedVoice) {
        depsRef.current?.onVoiceDropped(text)
      }
      // Wake mode / voice focus: background speech (TV, other people) never enters the
      // transcript as a normal turn.
      return
    }
    depsRef.current?.appendUserTurn(text)
    if (result.stopped) {
      depsRef.current?.stopListening()
    }
  }, [])

  const handleFinalText = useCallback(
    (text: string, level: number): void => {
      if (holdTimeoutRef.current !== null) {
        window.clearTimeout(holdTimeoutRef.current)
        holdTimeoutRef.current = null
      }
      const action = hold.onFinal(text, level)
      if (action.kind === 'hold') {
        setIsHolding(true)
        holdTimeoutRef.current = window.setTimeout(() => {
          holdTimeoutRef.current = null
          const held = hold.onTimeout()
          setIsHolding(false)
          if (held !== null) {
            void submitUtterance(held.text, held.level)
          }
        }, DANGLING_HOLD_GRACE_MS)
        return
      }
      setIsHolding(false)
      void submitUtterance(action.text, action.level)
    },
    [hold, submitUtterance]
  )

  // Why useMemo: CompanionPanel's mic-meter callback depends on `cancelHoldOnSpeaking`
  // via this object (`useCallback(..., [hold])`); without memoizing the returned object,
  // every CompanionPanel render (including the ~15/s re-renders the live meter level
  // triggers) produced a brand-new `hold` reference even though nothing in it actually
  // changed. That cascaded through useAudioCapture's `publishMeter` dependency into
  // `startCapture` -> `beginDictationSession` -> `restartForNextUtterance`, which in turn
  // is a dependency of CompanionPanel's silence-driven end-of-utterance `useEffect` — so
  // that effect tore down and recreated its 150ms interval on every meter tick, almost
  // never letting a single tick actually fire. The offline GigaAM model's finalization
  // (which only happens via that interval calling `restartForNextUtterance`) silently
  // never ran: utterances never finalized at all. See companion-utterance-hold-wiring.test.ts.
  return useMemo(
    () => ({ isHolding, depsRef, handleFinalText, cancelHoldOnSpeaking, clearHold }),
    [isHolding, depsRef, handleFinalText, cancelHoldOnSpeaking, clearHold]
  )
}
