import type { CompanionSettings } from './companion-types'

// Why a dedicated file: constants.ts is at the repo's max-lines budget; this default
// factory and its "why" comments are self-contained enough to live on their own.
export function getDefaultCompanionSettings(): CompanionSettings {
  return {
    enabled: false,
    hotkey: 'Alt+Space',
    homeDir: '',
    sttModel: 'gigaam-v3-e2e-rnnt-ru',
    // Why 2.5s (up from a legacy 1.6s): natural mid-sentence thinking pauses in Russian
    // speech routinely run 1.5-2s, and the offline STT model needs a stop/restart cycle
    // to flush its buffer — 1.6s was cutting people off before they finished a thought.
    endOfUtteranceSeconds: 2.5,
    voiceBargeIn: false,
    // Why 500/200ms: a chime or a click rarely carries 200ms of VAD-voiced audio, while even a
    // short "стоп" does; half a second of ducking is barely noticeable when it was a false alarm.
    voiceBargeInConfirm: { enabled: true, windowMs: 500, minVoicedMs: 200 },
    brainModel: 'sonnet',
    launchAtLogin: false,
    tts: {
      ttsEnabled: true,
      ttsVoice: 'eugene',
      ttsRate: 1,
      provider: 'silero',
      yandexVoice: 'kirill',
      maxSpokenChars: 250,
      yandexMonthlyBudgetRub: 300,
      qwenEmotion: 'neutral'
    },
    notify: {
      enabled: true,
      quietFrom: '22:00',
      quietTo: '08:00',
      speakAloud: true
    },
    wake: {
      enabled: false,
      phrases: ['джарвис'],
      followUpMs: 8000,
      keywordSpotter: false
    },
    endKeyword: {
      enabled: false,
      words: ['думай', 'всё', 'давай', 'делай', 'отправляй'],
      fallbackPauseSeconds: 2.5
    },
    showPanelOnAddress: false,
    autoHidePanelAfterReply: true,
    // VAD is more accurate about real trailing silence than the energy timer above, so
    // it affords a shorter window; denoiserEnabled/strictness per the offline eval under
    // /Users/evgenijsikunov/assistant/voice-lab/focus (report.md has the numbers).
    voiceFocus: {
      enabled: false,
      endOfUtteranceSeconds: 2,
      maxUtteranceSeconds: 60,
      denoiserEnabled: false,
      strictness: 'medium',
      showDropped: false
    }
  }
}
