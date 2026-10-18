import { describe, expect, it, vi } from 'vitest'
import { RuntimeCompanionController } from './runtime-companion-controller'
import { getCompanionBrain, type CompanionBrainEvent } from '../companion/companion-brain'
import type { RuntimeStore } from './runtime-store-contract'

vi.mock('../companion/companion-brain', () => ({
  getCompanionBrain: vi.fn()
}))

function fakeStore(): RuntimeStore {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the controller only calls `getSettings`, which `getCompanionBrain` is mocked away from reading here.
  return { getSettings: () => ({}) } as unknown as RuntimeStore
}

function mockBrain(
  send: (text: string, onEvent: (event: CompanionBrainEvent) => void) => Promise<void>,
  reset: () => void = vi.fn()
): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `RuntimeCompanionController` only calls `send` and `reset` on the brain it gets back.
  vi.mocked(getCompanionBrain).mockReturnValue({ send, reset } as never)
}

describe('RuntimeCompanionController', () => {
  it('returns the result frame text from a successful turn', async () => {
    const send = vi.fn(async (_text: string, onEvent: (event: CompanionBrainEvent) => void) => {
      onEvent({ type: 'delta', text: 'Hi' })
      onEvent({ type: 'final', text: 'Hi there' })
    })
    const reset = vi.fn()
    mockBrain(send, reset)

    const controller = new RuntimeCompanionController(() => fakeStore())
    const result = await controller.ask({ text: 'hi' })

    expect(result).toEqual({ text: 'Hi there' })
    expect(reset).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('hi', expect.any(Function))
  })

  it('resets the brain before asking when reset is requested', async () => {
    const send = vi.fn(async (_text: string, onEvent: (event: CompanionBrainEvent) => void) =>
      onEvent({ type: 'final', text: 'ok' })
    )
    const reset = vi.fn()
    mockBrain(send, reset)

    const controller = new RuntimeCompanionController(() => fakeStore())
    await controller.ask({ text: 'hi', reset: true })

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('throws when the brain reports an error event', async () => {
    const send = vi.fn(async (_text: string, onEvent: (event: CompanionBrainEvent) => void) =>
      onEvent({ type: 'error', message: 'boom' })
    )
    mockBrain(send)

    const controller = new RuntimeCompanionController(() => fakeStore())
    await expect(controller.ask({ text: 'hi' })).rejects.toThrow('boom')
  })

  it('refuses when no store is available', async () => {
    const controller = new RuntimeCompanionController(() => null)
    await expect(controller.ask({ text: 'hi' })).rejects.toThrow('companion_unavailable')
  })
})
