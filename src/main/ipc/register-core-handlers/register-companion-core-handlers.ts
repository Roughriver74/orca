// Companion (Jarvis) startup wiring, kept out of register-core-handlers.ts: its IPC handlers plus
// the hotkey, dialogue, agent-notice watch, TTS and panel singletons, each disposed on quit.

import { app } from 'electron'
import type { Store } from '../../persistence'
import { registerCompanionHandlers } from '../companion'
import { registerCompanionVoiceFocusHandlers } from '../companion-voice-focus'
import { registerCompanionTtsHandlers } from '../companion-tts'
import { initCompanionTtsProviderSettings } from '../../companion/tts/companion-tts-provider-settings-wiring'
import { initCompanionHotkey } from '../../companion/companion-shortcut'
import { companionDialogueHandle, initCompanionDialogue } from '../../companion/companion-dialogue'
import {
  getWarmedCompanionTtsService,
  startCompanionTtsServiceWarmup
} from '../../companion/tts/companion-tts-speaker-wiring'
import { initCompanionAgentWatch } from '../../companion/companion-agent-watch'
import { initCompanionAssets } from '../../companion/companion-assets'
import { initCompanionWakeListening } from '../../companion/companion-wake-listening'
import { initCompanionIndicator } from '../../companion/companion-indicator-lifecycle'
import { initCompanionPanelAutoHide } from '../../companion/companion-panel-visibility'

export function registerCompanionCoreHandlers(store: Store): void {
  registerCompanionHandlers(store)
  registerCompanionVoiceFocusHandlers()
  const disposeCompanionHotkey = initCompanionHotkey(store)
  app.once('will-quit', disposeCompanionHotkey)
  startCompanionTtsServiceWarmup()
  const disposeCompanionDialogue = initCompanionDialogue(store, getWarmedCompanionTtsService)
  app.once('will-quit', disposeCompanionDialogue)
  const disposeCompanionAgentWatch = initCompanionAgentWatch(store, {
    speakNotice: (phrase) => companionDialogueHandle.current?.speakAnnouncement(phrase)
  })
  app.once('will-quit', disposeCompanionAgentWatch)
  app.once('will-quit', initCompanionAssets(store))
  registerCompanionTtsHandlers(store)
  initCompanionTtsProviderSettings(store)
  app.once('will-quit', initCompanionWakeListening(store))
  app.once('will-quit', initCompanionIndicator())
  app.once('will-quit', initCompanionPanelAutoHide(store))
}
