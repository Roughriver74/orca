// What a hotkey press should do depends on what's happening right now (assignment point
// 4): pressing it while Jarvis is speaking is always barge-in (interrupt and listen);
// pressing it while the user is mid-utterance finalizes and sends that utterance
// immediately instead of waiting out the VAD/energy silence timer; otherwise it is the
// ordinary open/close toggle. Pure decision, no I/O — the caller (hotkey handler) wires
// the resulting action to VadSegmentationService.finalizeNow() / barge-in / toggle.

export type HotkeyFinalizeState = {
  /** The VAD (or energy fallback) currently judges the user to be mid-speech. */
  userSpeaking: boolean
  /** Jarvis is currently speaking a reply (TTS playback in progress). */
  jarvisSpeaking: boolean
}

export type HotkeyFinalizeAction = 'finalize' | 'barge-in' | 'toggle'

export function decideHotkeyPressAction(state: HotkeyFinalizeState): HotkeyFinalizeAction {
  if (state.jarvisSpeaking) {
    return 'barge-in'
  }
  if (state.userSpeaking) {
    return 'finalize'
  }
  return 'toggle'
}
