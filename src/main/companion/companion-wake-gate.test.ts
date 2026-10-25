import { describe, expect, it } from 'vitest'
import type { CompanionWakeSettings } from '../../shared/companion-types'
import { createCompanionWakeGate, findWakePhrase } from './companion-wake-gate'

const PHRASES = ['джарвис', 'эй компьютер']

describe('findWakePhrase', () => {
  it('finds the name and returns the request after it', () => {
    expect(findWakePhrase('Джарвис, какая погода?', PHRASES)).toMatchObject({
      remainder: 'какая погода?'
    })
  })

  it('drops background speech merged in front of the address', () => {
    expect(findWakePhrase('и в эфире новости спорта Джарвис включи свет', PHRASES)).toMatchObject({
      remainder: 'включи свет'
    })
  })

  it('tolerates STT slips and case endings in the name', () => {
    expect(findWakePhrase('Жарвис, привет', PHRASES)).toMatchObject({ remainder: 'привет' })
    expect(findWakePhrase('Джарвису скажи привет', PHRASES)).toMatchObject({
      remainder: 'скажи привет'
    })
    expect(findWakePhrase('ДЖАРВИС!', PHRASES)).toMatchObject({ remainder: '' })
  })

  it('matches multi-word phrases and ё/е variants', () => {
    expect(findWakePhrase('Эй, компьютер: время?', PHRASES)).toMatchObject({ remainder: 'время?' })
    expect(findWakePhrase('Алёша, свет', ['алеша'])).toMatchObject({ remainder: 'свет' })
  })

  it('does not fire on unrelated words', () => {
    expect(findWakePhrase('Сегодня в Джакарте жарко', PHRASES)).toBeNull()
    expect(findWakePhrase('Эй, кто там?', PHRASES)).toBeNull()
  })
})

function gateHarness(overrides: Partial<CompanionWakeSettings> = {}, keywordSpotterActive = false) {
  let now = 0
  const settings: CompanionWakeSettings = {
    enabled: true,
    phrases: ['джарвис'],
    followUpMs: 8000,
    keywordSpotter: false,
    ...overrides
  }
  const gate = createCompanionWakeGate({
    getSettings: () => settings,
    now: () => now,
    isKeywordSpotterActive: () => keywordSpotterActive
  })
  return {
    gate,
    settings,
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('createCompanionWakeGate', () => {
  it('passes everything through unchanged when wake mode is off', () => {
    const { gate } = gateHarness({ enabled: false })
    expect(gate.decide('по телевизору новости', { state: 'listening' })).toEqual({
      kind: 'pass',
      text: 'по телевизору новости',
      addressed: false
    })
  })

  it('ignores background speech that does not address Jarvis', () => {
    const { gate } = gateHarness()
    gate.onStateChange('listening')
    expect(gate.decide('а потом они поехали на дачу', { state: 'listening' })).toEqual({
      kind: 'ignore'
    })
  })

  it('passes the request after the name and strips the name', () => {
    const { gate } = gateHarness()
    expect(gate.decide('Джарвис, сколько времени?', { state: 'listening' })).toEqual({
      kind: 'pass',
      text: 'сколько времени?',
      addressed: true
    })
  })

  it('a bare name opens a window for the request that follows the pause', () => {
    const { gate, advance } = gateHarness({ followUpMs: 0 })
    expect(gate.decide('Джарвис!', { state: 'listening' })).toEqual({ kind: 'wake-only' })
    advance(5000)
    expect(gate.decide('включи музыку', { state: 'listening' })).toEqual({
      kind: 'pass',
      text: 'включи музыку',
      addressed: false
    })
    expect(gate.decide('и ещё громче', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  it('accepts follow-ups without the name for a short window after a reply', () => {
    const { gate, advance } = gateHarness({ followUpMs: 8000 })
    gate.onStateChange('listening')
    gate.decide('Джарвис, какая погода', { state: 'listening' })
    gate.onStateChange('thinking')
    gate.onStateChange('speaking')
    gate.onStateChange('listening')

    advance(7000)
    expect(gate.decide('а завтра?', { state: 'listening' }).kind).toBe('pass')

    gate.onStateChange('thinking')
    gate.onStateChange('listening')
    advance(9000)
    expect(gate.decide('а послезавтра?', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  it('needs the name every time when the follow-up window is 0', () => {
    const { gate } = gateHarness({ followUpMs: 0 })
    gate.onStateChange('thinking')
    gate.onStateChange('listening')
    expect(gate.decide('а завтра?', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  it('rejects a follow-up much quieter than the person who addressed Jarvis (a TV across the room)', () => {
    const { gate } = gateHarness()
    gate.decide('Джарвис, какая погода', { state: 'listening', level: 0.6 })
    gate.onStateChange('thinking')
    gate.onStateChange('listening')
    expect(gate.decide('в эфире новости', { state: 'listening', level: 0.15 })).toEqual({
      kind: 'ignore'
    })
    expect(gate.decide('а завтра?', { state: 'listening', level: 0.5 }).kind).toBe('pass')
  })

  it('only the name counts while Jarvis is speaking or thinking', () => {
    const { gate } = gateHarness()
    gate.address()
    expect(gate.decide('бла-бла из телевизора', { state: 'speaking' })).toEqual({ kind: 'ignore' })
    expect(gate.decide('бла-бла из телевизора', { state: 'thinking' })).toEqual({ kind: 'ignore' })
    expect(gate.decide('Джарвис, хватит', { state: 'speaking' })).toEqual({
      kind: 'pass',
      text: 'хватит',
      addressed: true
    })
  })

  it('treats the hotkey as an address and dismiss as closing the window', () => {
    const { gate } = gateHarness({ followUpMs: 0 })
    gate.address()
    expect(gate.decide('что нового', { state: 'listening' }).kind).toBe('pass')
    gate.address()
    gate.dismiss()
    expect(gate.decide('что нового', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  it('forgets the window when the conversation ends', () => {
    const { gate } = gateHarness()
    gate.address()
    gate.onStateChange('idle')
    expect(gate.decide('что нового', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  describe('while an end-keyword request is being dictated', () => {
    it('passes continuation segments without the name, however long the pause', () => {
      const { gate, advance } = gateHarness({ followUpMs: 0 })
      gate.decide('Джарвис, хочу чтобы ты', { state: 'listening', level: 0.4 })
      advance(60_000)
      expect(
        gate.decide('посмотрел логи', { state: 'listening', level: 0.4, continuing: true })
      ).toEqual({ kind: 'pass', text: 'посмотрел логи', addressed: false })
    })

    it('keeps a name mentioned mid-sentence as part of the request', () => {
      const { gate } = gateHarness()
      expect(
        gate.decide('сделай, чтобы Джарвис отвечал быстрее', {
          state: 'listening',
          continuing: true
        })
      ).toEqual({ kind: 'pass', text: 'сделай, чтобы Джарвис отвечал быстрее', addressed: false })
      expect(gate.decide('Джарвис, стоп', { state: 'listening', continuing: true })).toEqual({
        kind: 'pass',
        text: 'стоп',
        addressed: true
      })
    })

    it('still drops quiet background speech and anything heard while Jarvis talks', () => {
      const { gate } = gateHarness()
      gate.decide('Джарвис, хочу чтобы ты', { state: 'listening', level: 0.4 })
      expect(
        gate.decide('новости спорта', { state: 'listening', level: 0.1, continuing: true })
      ).toEqual({ kind: 'ignore' })
      expect(gate.decide('эхо ответа', { state: 'speaking', continuing: true })).toEqual({
        kind: 'ignore'
      })
    })
  })
})

describe('createCompanionWakeGate with the keyword spotter running', () => {
  it('ignores a transcript wake phrase the spotter did not hear (TV weekday)', () => {
    const { gate } = gateHarness({ phrases: ['пятница'] }, true)
    expect(gate.decide('В эту пятницу состоится матч.', { state: 'listening' })).toEqual({
      kind: 'ignore'
    })
  })

  it('addresses only when the spotter hit and the transcript name agree', () => {
    const { gate } = gateHarness({}, true)
    gate.noteKeyword()
    expect(gate.decide('Джарвис, открой почту.', { state: 'listening' })).toEqual({
      kind: 'pass',
      text: 'открой почту.',
      addressed: true
    })
    // A spotter hit on TV audio whose transcript names nobody stays ignored.
    gate.noteKeyword()
    expect(gate.decide('Дарвин писал о видах.', { state: 'listening' })).toEqual({
      kind: 'ignore'
    })
  })

  it('falls back to transcript matching when the spotter is not running', () => {
    const { gate } = gateHarness({ keywordSpotter: true }, false)
    expect(gate.decide('Джарвис, свет', { state: 'listening' })).toMatchObject({ kind: 'pass' })
  })

  it('spends a hit on the next utterance and drops a stale one', () => {
    const { gate, advance } = gateHarness({}, true)
    gate.noteKeyword()
    expect(gate.decide('Джарвис!', { state: 'listening' })).toEqual({ kind: 'wake-only' })
    advance(9000)
    expect(gate.decide('Джарвис, свет', { state: 'listening' })).toEqual({ kind: 'ignore' })
    gate.noteKeyword()
    advance(61_000)
    expect(gate.decide('Джарвис, свет', { state: 'listening' })).toEqual({ kind: 'ignore' })
  })

  it('still lets follow-ups through without a hit', () => {
    const { gate } = gateHarness({}, true)
    gate.noteKeyword()
    expect(gate.decide('Джарвис', { state: 'listening' })).toEqual({ kind: 'wake-only' })
    expect(gate.decide('какая погода', { state: 'listening' })).toEqual({
      kind: 'pass',
      text: 'какая погода',
      addressed: false
    })
  })
})
