import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeCompanionController } from './runtime-companion-controller'
import { getCompanionBrain, type CompanionBrainEvent } from '../companion/companion-brain'
import { companionConversation } from '../companion/companion-conversation'
import { getCompanionTtsProvisioningStatus } from '../companion/tts/companion-tts-provisioning'
import { toggleCompanionConversation } from '../companion/companion-shortcut'
import type { RuntimeStore } from './runtime-store-contract'

vi.mock('../companion/companion-brain', () => ({
  getCompanionBrain: vi.fn()
}))

vi.mock('../companion/tts/companion-tts-provisioning', () => ({
  getCompanionTtsProvisioningStatus: vi.fn()
}))

// Why mocked: `toggle()` dynamically imports this module (it pulls in `electron` at module
// scope); mocking it here exercises the delegation without needing a real hotkey/globalShortcut.
vi.mock('../companion/companion-shortcut', () => ({
  toggleCompanionConversation: vi.fn()
}))

vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '/tmp/orca-test-userdata' })
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

describe('RuntimeCompanionController status/toggle', () => {
  afterEach(() => {
    companionConversation.stop()
    vi.mocked(toggleCompanionConversation).mockReset()
  })

  function fakeCompanionStore(
    companion: { enabled: boolean; hotkey: string } = { enabled: true, hotkey: 'Alt+Space' }
  ): RuntimeStore {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the controller only reads `getSettings().companion`.
    return { getSettings: () => ({ companion }) } as unknown as RuntimeStore
  }

  it('reports enabled, hotkey and the conversation snapshot through a full turn', async () => {
    vi.mocked(getCompanionTtsProvisioningStatus).mockResolvedValue({
      status: 'ready',
      progress: 100
    })
    const controller = new RuntimeCompanionController(() =>
      fakeCompanionStore({ enabled: true, hotkey: 'Cmd+J' })
    )

    companionConversation.start()
    companionConversation.reportUtterance('привет')
    companionConversation.reportAssistantFinal('привет! чем помочь?')

    const status = await controller.status()

    expect(status).toMatchObject({
      enabled: true,
      state: 'listening',
      hotkey: 'Cmd+J',
      lastUserText: 'привет',
      lastAssistantText: 'привет! чем помочь?',
      tts: { status: 'ready', progress: 100 }
    })
    expect(status.updatedAt).toBeGreaterThan(0)
  })

  it('reports enabled: false with no store-backed companion settings', async () => {
    vi.mocked(getCompanionTtsProvisioningStatus).mockResolvedValue({ status: 'idle' })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the controller only reads `getSettings().companion`.
    const controller = new RuntimeCompanionController(
      () => ({ getSettings: () => ({}) }) as unknown as RuntimeStore
    )

    const status = await controller.status()

    expect(status.enabled).toBe(false)
  })

  it('delegates toggle to toggleCompanionConversation (the hotkey handler) when enabled', async () => {
    vi.mocked(toggleCompanionConversation).mockImplementation(() => companionConversation.start())
    const controller = new RuntimeCompanionController(() =>
      fakeCompanionStore({ enabled: true, hotkey: 'Alt+Space' })
    )

    const result = await controller.toggle()

    expect(toggleCompanionConversation).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ state: 'listening' })
  })

  it('rejects toggle with a clear code when the companion is disabled', async () => {
    const controller = new RuntimeCompanionController(() =>
      fakeCompanionStore({ enabled: false, hotkey: 'Alt+Space' })
    )

    await expect(controller.toggle()).rejects.toThrow('companion_disabled')
    expect(toggleCompanionConversation).not.toHaveBeenCalled()
  })
})
