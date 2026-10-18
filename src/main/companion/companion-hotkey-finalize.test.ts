import { describe, expect, it } from 'vitest'
import { decideHotkeyPressAction } from './companion-hotkey-finalize'

describe('decideHotkeyPressAction', () => {
  it('barges in when Jarvis is speaking, even if the user is also speaking', () => {
    expect(decideHotkeyPressAction({ userSpeaking: true, jarvisSpeaking: true })).toBe('barge-in')
  })

  it('barges in when Jarvis is speaking and the user is silent', () => {
    expect(decideHotkeyPressAction({ userSpeaking: false, jarvisSpeaking: true })).toBe('barge-in')
  })

  it('finalizes immediately when the user is mid-utterance and Jarvis is silent', () => {
    expect(decideHotkeyPressAction({ userSpeaking: true, jarvisSpeaking: false })).toBe('finalize')
  })

  it('falls back to the ordinary open/close toggle otherwise', () => {
    expect(decideHotkeyPressAction({ userSpeaking: false, jarvisSpeaking: false })).toBe('toggle')
  })
})
