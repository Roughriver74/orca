// Text that already went through normalizeForSpeech is written for Silero; this adapts
// it to Qwen3-TTS just before the request. Silero's `*word*` focus markup is dropped, and
// `+` stress marks (from the user's pronunciation dictionary) are rewritten, because Qwen3
// reads a raw `+` aloud as «плюс» and U+0301 garbles the word.
//
// Measured on 38 homograph/stress items × 8 rewrites × 2 takes (Whisper + a vowel-reduction
// stress probe, ~/assistant/voice-lab/qwen-stress): spelling the reduction out — every
// unstressed «о» of the marked word written as «а» (з+амок → «замак», позвон+ит →
// «пазванит») — moved correct stress from 51% (marks just dropped, i.e. a coin flip) to
// 71% with 1 garbled word in 76. Also capitalizing the stressed vowel scored 73% but
// garbled 6 in 76, so it is not used. Stress on other vowels is not controllable this way.

const MARKED_WORD = /[а-яё+]*\+[аеёиоуыэюя][а-яё+]*/giu
const FOCUS_ASTERISK = /\*/g

function spellOutReduction(word: string): string {
  let spelled = ''
  let stressed = false
  for (const letter of word) {
    if (letter === '+') {
      stressed = true
      continue
    }
    spelled += stressed ? letter : letter.replace('о', 'а').replace('О', 'А')
    stressed = false
  }
  return spelled
}

export function prepareQwen3SpeechText(text: string): string {
  return text.replace(FOCUS_ASTERISK, '').replace(MARKED_WORD, spellOutReduction)
}
