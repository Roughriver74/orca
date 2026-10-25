import { describe, expect, it, vi } from 'vitest'
import {
  createCompanionVoiceBargeInGate,
  type CompanionBargeInSpeechSource,
  type CompanionVoiceBargeInGate,
  type CompanionVoiceBargeInGateMode,
  type CompanionVoiceBargeInGateVerdict
} from './companion-voice-barge-in-gate'

const FRAME_MS = 50
const CONFIRMING: CompanionVoiceBargeInGateMode = {
  wakeMode: false,
  confirm: { enabled: true, windowMs: 500, minVoicedMs: 200 }
}

type FakeSpeech = {
  source: CompanionBargeInSpeechSource
  setSpeech: (speech: boolean | null) => void
}

function fakeSpeech(): FakeSpeech {
  let speech: boolean | null = false
  return {
    source: { feed: vi.fn(), isSpeech: () => speech, reset: vi.fn() },
    setSpeech: (value) => {
      speech = value
    }
  }
}

function feedFor(
  gate: CompanionVoiceBargeInGate,
  durationMs: number,
  micLevel: number,
  playbackLevel: number,
  mode: CompanionVoiceBargeInGateMode = CONFIRMING
): CompanionVoiceBargeInGateVerdict[] {
  const verdicts: CompanionVoiceBargeInGateVerdict[] = []
  for (let elapsed = 0; elapsed < durationMs; elapsed += FRAME_MS) {
    const samples = new Float32Array(16)
    verdicts.push(
      gate.feed(
        { micLevel, playbackLevel, durationMs: FRAME_MS, audio: { samples, sampleRate: 16_000 } },
        mode
      )
    )
  }
  return verdicts
}

/** Calibrated on Jarvis's echo at 0.3× output, then a 500ms pause between his phrases —
 *  where the echo threshold has fallen to its absolute floor. */
function gateInPause(): FakeSpeech & { gate: CompanionVoiceBargeInGate } {
  const speech = fakeSpeech()
  const gate = createCompanionVoiceBargeInGate(speech.source)
  feedFor(gate, 600, 0.06, 0.2)
  feedFor(gate, 500, 0.005, 0)
  return { gate, ...speech }
}

describe('createCompanionVoiceBargeInGate', () => {
  it('a notification chime without speech never interrupts and ducks the reply only once', () => {
    const { gate } = gateInPause()
    const verdicts = feedFor(gate, 3000, 0.05, 0)
    expect(verdicts).not.toContain('barge-in')
    const duckStarts = verdicts.filter(
      (verdict, index) => verdict === 'ducked' && verdicts[index - 1] !== 'ducked'
    )
    expect(duckStarts).toHaveLength(1)
    expect(verdicts.at(-1)).toBe('none')
  })

  it('a false trigger restores the volume after the window, and real speech still interrupts later', () => {
    const { gate, setSpeech } = gateInPause()
    const chime = [...feedFor(gate, 400, 0.05, 0), ...feedFor(gate, 500, 0.005, 0)]
    expect(chime.indexOf('ducked')).toBe(5)
    expect(chime.lastIndexOf('ducked')).toBe(5 + 500 / FRAME_MS - 1)
    expect(chime.at(-1)).toBe('none')

    setSpeech(true)
    expect(feedFor(gate, 400, 0.3, 0.2)).toContain('barge-in')
    expect(gate.hasConfirmedRealSpeech()).toBe(true)
  })

  it('speech the VAD confirms a little late interrupts within the ducked window', () => {
    const { gate, setSpeech } = gateInPause()
    const onset = feedFor(gate, 150, 0.3, 0.2)
    setSpeech(true)
    const verdicts = [...onset, ...feedFor(gate, 300, 0.3, 0.2)]
    expect(verdicts.slice(5)).toEqual(['ducked', 'barge-in', 'none', 'none'])
  })

  it('a clear short "стоп" interrupts on the trigger frame, without ducking first', () => {
    const { gate, setSpeech } = gateInPause()
    setSpeech(true)
    const verdicts = feedFor(gate, 350, 0.3, 0.2)
    expect(verdicts.indexOf('barge-in')).toBe(5)
    expect(verdicts).not.toContain('ducked')
  })

  it('never counts its own echo as speech, even while the VAD hears voice in it', () => {
    const { gate, setSpeech } = gateInPause()
    setSpeech(true)
    expect(feedFor(gate, 3000, 0.12, 0.4)).toEqual(Array(60).fill('none'))
  })

  it('without a VAD, the sound must outlast the trigger by minVoicedMs', () => {
    const { gate, setSpeech } = gateInPause()
    setSpeech(null)
    const chime = feedFor(gate, 400, 0.05, 0)
    expect(chime).not.toContain('barge-in')
    feedFor(gate, 600, 0.005, 0)
    const voice = feedFor(gate, 600, 0.3, 0.2)
    expect(voice.indexOf('barge-in')).toBe(5 + 200 / FRAME_MS)
  })

  it('with confirmation off, a chime alone barges in as before and the VAD is not fed', () => {
    const speech = fakeSpeech()
    const gate = createCompanionVoiceBargeInGate(speech.source)
    const off = { wakeMode: false, confirm: { ...CONFIRMING.confirm, enabled: false } }
    feedFor(gate, 600, 0.06, 0.2, off)
    feedFor(gate, 500, 0.005, 0, off)
    expect(feedFor(gate, 300, 0.05, 0, off).at(-1)).toBe('barge-in')
    expect(speech.source.feed).not.toHaveBeenCalled()
  })

  it('in wake mode it never barges in, only confirms real speech', () => {
    const speech = fakeSpeech()
    const gate = createCompanionVoiceBargeInGate(speech.source)
    const wake = { ...CONFIRMING, wakeMode: true }
    feedFor(gate, 600, 0.06, 0.2, wake)
    expect(feedFor(gate, 1000, 0.35, 0.2, wake)).not.toContain('barge-in')
    expect(gate.hasConfirmedRealSpeech()).toBe(true)
    gate.reset()
    expect(gate.hasConfirmedRealSpeech()).toBe(false)
    expect(speech.source.reset).toHaveBeenCalled()
  })
})
