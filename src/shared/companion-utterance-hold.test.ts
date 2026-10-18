import { describe, expect, it } from 'vitest'
import { CompanionUtteranceHold } from './companion-utterance-hold'

describe('CompanionUtteranceHold', () => {
  it('submits a complete utterance immediately', () => {
    const hold = new CompanionUtteranceHold()

    const action = hold.onFinal('Привет, как дела?', 0.5)

    expect(action).toEqual({ kind: 'submit', text: 'Привет, как дела?', level: 0.5 })
    expect(hold.isHolding).toBe(false)
  })

  it('holds a dangling utterance instead of submitting it', () => {
    const hold = new CompanionUtteranceHold()

    const action = hold.onFinal('Сделай коммит и', 0.4)

    expect(action).toEqual({ kind: 'hold' })
    expect(hold.isHolding).toBe(true)
  })

  it('appends a resumed utterance to the held text and re-evaluates it', () => {
    const hold = new CompanionUtteranceHold()
    hold.onFinal('Сделай коммит и', 0.4)

    const action = hold.onFinal('запусти тесты.', 0.6)

    expect(action).toEqual({
      kind: 'submit',
      text: 'Сделай коммит и запусти тесты.',
      level: 0.6
    })
    expect(hold.isHolding).toBe(false)
  })

  it('keeps holding when the appended continuation is itself still dangling', () => {
    const hold = new CompanionUtteranceHold()
    hold.onFinal('Сделай коммит и', 0.3)

    const action = hold.onFinal('запусти тесты а', 0.5)

    expect(action).toEqual({ kind: 'hold' })
    expect(hold.isHolding).toBe(true)

    const final = hold.onFinal('потом задеплой.', 0.2)
    expect(final).toEqual({
      kind: 'submit',
      text: 'Сделай коммит и запусти тесты а потом задеплой.',
      level: 0.5
    })
  })

  it('tracks the louder of the held and continuation levels for wake mode', () => {
    const hold = new CompanionUtteranceHold()
    hold.onFinal('Джарвис, сделай коммит и', 0.9)

    const action = hold.onFinal('запусти тесты.', 0.2)

    expect(action).toEqual({
      kind: 'submit',
      text: 'Джарвис, сделай коммит и запусти тесты.',
      level: 0.9
    })
  })

  it('onTimeout returns and clears the held text when the grace window elapses', () => {
    const hold = new CompanionUtteranceHold()
    hold.onFinal('Сделай коммит и', 0.4)

    const timedOut = hold.onTimeout()

    expect(timedOut).toEqual({ text: 'Сделай коммит и', level: 0.4 })
    expect(hold.isHolding).toBe(false)
  })

  it('onTimeout is a no-op when nothing is held', () => {
    const hold = new CompanionUtteranceHold()

    expect(hold.onTimeout()).toBeNull()
  })

  it('reset drops held text without returning it', () => {
    const hold = new CompanionUtteranceHold()
    hold.onFinal('Сделай коммит и', 0.4)

    hold.reset()

    expect(hold.isHolding).toBe(false)
    expect(hold.onTimeout()).toBeNull()
  })
})
