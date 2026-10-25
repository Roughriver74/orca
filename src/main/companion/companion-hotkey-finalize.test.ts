import { describe, expect, it } from 'vitest'
import { decideHotkeyPressAction } from './companion-hotkey-finalize'

describe('decideHotkeyPressAction', () => {
  it('barges in when Jarvis is speaking, even if the user is also speaking', () => {
    expect(
      decideHotkeyPressAction({ userSpeaking: true, jarvisSpeaking: true, requestHeld: false })
    ).toBe('barge-in')
  })

  it('barges in when Jarvis is speaking and the user is silent', () => {
    expect(
      decideHotkeyPressAction({ userSpeaking: false, jarvisSpeaking: true, requestHeld: false })
    ).toBe('barge-in')
  })

  it('finalizes immediately when the user is mid-utterance and Jarvis is silent', () => {
    expect(
      decideHotkeyPressAction({ userSpeaking: true, jarvisSpeaking: false, requestHeld: false })
    ).toBe('finalize')
  })

  it('sends a held end-keyword request instead of closing the conversation', () => {
    expect(
      decideHotkeyPressAction({ userSpeaking: false, jarvisSpeaking: false, requestHeld: true })
    ).toBe('send-held')
  })

  it('falls back to the ordinary open/close toggle otherwise', () => {
    expect(
      decideHotkeyPressAction({ userSpeaking: false, jarvisSpeaking: false, requestHeld: false })
    ).toBe('toggle')
  })
})
