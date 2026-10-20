// Backlog #28: shows/hides the pill (companion-indicator-window.ts) off two independent
// signals — the live conversation state (companion-conversation.ts) and whether Riverline's
// own menu-bar notch is already showing it (companion-riverline-detection.ts). The policy
// itself (`decideCompanionIndicatorVisible`) is pure so it is testable without Electron.

import {
  companionConversation,
  onCompanionStateChange,
  type CompanionConversationState
} from './companion-conversation'
import { createCompanionRiverlineWatcher } from './companion-riverline-detection'
import {
  hideCompanionIndicator,
  sendToCompanionIndicatorWindow,
  showCompanionIndicator
} from '../window/companion-indicator-window'

/** The pill only earns its keep while Jarvis is doing something (listening for a request,
 *  thinking, or speaking) and Riverline isn't already showing the same state elsewhere. */
export function decideCompanionIndicatorVisible(args: {
  riverlineRunning: boolean
  state: CompanionConversationState
}): boolean {
  return !args.riverlineRunning && args.state !== 'idle'
}

/** Wires the pill to the live conversation state + Riverline watcher. Returns a disposer;
 *  safe to call once per app lifetime (mirrors `initCompanionHotkey`). */
export function initCompanionIndicator(): () => void {
  let riverlineRunning = false

  const applyVisibility = (): void => {
    const state = companionConversation.getState()
    if (decideCompanionIndicatorVisible({ riverlineRunning, state })) {
      showCompanionIndicator()
      sendToCompanionIndicatorWindow('companion:stateChanged', state)
    } else {
      hideCompanionIndicator()
    }
  }

  const offState = onCompanionStateChange(() => applyVisibility())
  const riverlineWatcher = createCompanionRiverlineWatcher({ platform: process.platform })
  const disposeRiverlineWatch = riverlineWatcher.start((running) => {
    riverlineRunning = running
    applyVisibility()
  })

  return () => {
    offState()
    disposeRiverlineWatch()
  }
}
