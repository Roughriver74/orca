// Backlog #28: the big companion panel only opens on explicit request now (hotkey,
// "Обсудить", or wake mode with `showPanelOnAddress` on — see companion-wake-listening.ts) and
// must get out of the way again on its own once the exchange is over, instead of sitting over
// the user's windows until the next hotkey press. `scheduleAfterReply` arms a fixed delay the
// moment a reply finishes playing; `cancel` is called the instant the user starts talking again
// (a fresh turn) or the conversation stops outright ("стоп" already hides immediately via the
// existing stop-phrase paths in companion-wake-listening.ts/companion-shortcut.ts).

/** Delay after a reply finishes playing before the big panel auto-hides, long enough for the
 *  user to glance at the transcript without feeling rushed, short enough to actually get out
 *  of the way for a reply nobody is following up on. */
export const COMPANION_PANEL_AUTO_HIDE_DELAY_MS = 6_000

export type CompanionPanelAutoHideDeps = {
  hide: () => void
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void
  delayMs?: number
}

export type CompanionPanelAutoHide = {
  /** Arms the hide timer; replaces any timer already pending. */
  scheduleAfterReply: () => void
  /** Clears any pending timer without hiding — the user kept talking or the panel already closed. */
  cancel: () => void
}

/** Fixed-delay, cancellable auto-hide — not a generic debounce: `scheduleAfterReply` always
 *  (re)arms the same delay from now, there is no notion of "extending" one in progress. */
export function createCompanionPanelAutoHide(
  deps: CompanionPanelAutoHideDeps
): CompanionPanelAutoHide {
  const setTimer: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout> =
    deps.setTimer ?? setTimeout
  const clearTimer = deps.clearTimer ?? clearTimeout
  const delayMs = deps.delayMs ?? COMPANION_PANEL_AUTO_HIDE_DELAY_MS
  let pending: ReturnType<typeof setTimeout> | null = null

  return {
    scheduleAfterReply() {
      if (pending !== null) {
        clearTimer(pending)
      }
      pending = setTimer(() => {
        pending = null
        deps.hide()
      }, delayMs)
    },
    cancel() {
      if (pending !== null) {
        clearTimer(pending)
        pending = null
      }
    }
  }
}
