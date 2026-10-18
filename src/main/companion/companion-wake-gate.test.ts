import { describe, expect, it } from 'vitest'
import type { CompanionWakeSettings } from '../../shared/companion-types'
import { createCompanionWakeGate, findWakePhrase } from './companion-wake-gate'

const PHRASES = ['джарвис', 'эй компьютер']

describe('findWakePhrase', () => {
  it('finds the name and returns the request after it', () => {
    expect(findWakePhrase('Джарвис, какая погода?', PHRASES)).toEqual({
      remainder: 'какая погода?'
    })
  })

  it('drops background speech merged in front of the address', () => {
    expect(findWakePhrase('и в эфире новости спорта Джарвис включи свет', PHRASES)).toEqual({
      remainder: 'включи свет'
    })
  })

  it('tolerates STT slips and case endings in the name', () => {
    expect(findWakePhrase('Жарвис, привет', PHRASES)).toEqual({ remainder: 'привет' })
    expect(findWakePhrase('Джарвису скажи привет', PHRASES)).toEqual({ remainder: 'скажи привет' })
    expect(findWakePhrase('ДЖАРВИС!', PHRASES)).toEqual({ remainder: '' })
  })

  it('matches multi-word phrases and ё/е variants', () => {
    expect(findWakePhrase('Эй, компьютер: время?', PHRASES)).toEqual({ remainder: 'время?' })
    expect(findWakePhrase('Алёша, свет', ['алеша'])).toEqual({ remainder: 'свет' })
  })

  it('does not fire on unrelated words', () => {
    expect(findWakePhrase('Сегодня в Джакарте жарко', PHRASES)).toBeNull()
    expect(findWakePhrase('Эй, кто там?', PHRASES)).toBeNull()
  })
})

function gateHarness(overrides: Partial<CompanionWakeSettings> = {}) {
  let now = 0
  const settings: CompanionWakeSettings = {
    enabled: true,
    phrases: ['джарвис'],
    followUpMs: 8000,
    ...overrides
  }
  const gate = createCompanionWakeGate({ getSettings: () => settings, now: () => now })
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
})
