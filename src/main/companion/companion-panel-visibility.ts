// Backlog #28: wires companion-panel-auto-hide.ts's timer to the real TTS playback-ended
// signal (companion-audio-output.ts's `onAudioState`) and the real "user kept talking" signal
// (companion-conversation.ts's `onCompanionUtterance`), gated by the
// `companion.autoHidePanelAfterReply` setting. "стоп" already hides the panel immediately via
// the existing stop-phrase paths in companion-wake-listening.ts/companion-shortcut.ts, which
// also cancels any pending auto-hide for free (the conversation goes idle, no further utterance
// or audio-state event follows to re-arm it).

import type { CompanionSettings } from '../../shared/companion-types'
import { normalizeCompanionSettings } from '../persistence/applying-settings/companion-settings-normalization'
import { hideCompanionPanel } from '../window/companion-window'
import { onAudioState } from './companion-audio-output'
import { createCompanionPanelAutoHide } from './companion-panel-auto-hide'
import { onCompanionUtterance } from './companion-conversation'

export type CompanionPanelAutoHideStore = {
  getSettings: () => { companion?: CompanionSettings }
}

/** Wires the auto-hide timer to the live companion singletons. Returns a disposer; safe to
 *  call once per app lifetime (mirrors `initCompanionHotkey`). */
export function initCompanionPanelAutoHide(store: CompanionPanelAutoHideStore): () => void {
  const autoHide = createCompanionPanelAutoHide({ hide: hideCompanionPanel })

  const offAudioState = onAudioState((state) => {
    if (state.state !== 'ended') {
      return
    }
    const companion = normalizeCompanionSettings(store.getSettings().companion)
    if (companion.autoHidePanelAfterReply) {
      autoHide.scheduleAfterReply()
    }
  })

  // A fresh utterance means the user is talking again — the exchange is not over yet.
  const offUtterance = onCompanionUtterance(() => autoHide.cancel())

  return () => {
    offAudioState()
    offUtterance()
    autoHide.cancel()
  }
}
