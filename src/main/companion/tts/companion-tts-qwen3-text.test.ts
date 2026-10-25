import { describe, expect, it } from 'vitest'
import { prepareQwen3SpeechText } from './companion-tts-qwen3-text'

describe('prepareQwen3SpeechText', () => {
  it('spells out vowel reduction in stress-marked words so no «плюс» reaches Qwen3', () => {
    expect(prepareQwen3SpeechText('Старинный з+амок, а на двери зам+ок.')).toBe(
      'Старинный замак, а на двери замок.'
    )
    expect(prepareQwen3SpeechText('Агент позвон+ит, когда догов+ор готов.')).toBe(
      'Агент пазванит, когда дагавор готов.'
    )
  })

  it('keeps case, hyphenated particles and unmarked words untouched', () => {
    expect(prepareQwen3SpeechText('З+АМОК-то стоит, а в доме тихо.')).toBe(
      'ЗАМАК-то стоит, а в доме тихо.'
    )
  })

  it('leaves a stressed «ё» and a «+» that is not stress markup alone', () => {
    expect(prepareQwen3SpeechText('+ёлка у окна, два + два.')).toBe('ёлка у окна, два + два.')
  })

  it('drops Silero focus asterisks', () => {
    expect(prepareQwen3SpeechText('Это *очень* важно.')).toBe('Это очень важно.')
  })
})
