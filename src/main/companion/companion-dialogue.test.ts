import { describe, expect, it, vi } from 'vitest'
// Why mocked: `createCompanionDialogue` (the only thing under test) takes every
// dependency as a parameter; these modules are only reached by `initCompanionDialogue`'s
// production wiring, which this file never calls. Mocking them keeps the import graph
// free of electron (`companion-window.ts`) and the real Claude/TTS stacks.
vi.mock('../window/companion-window', () => ({ sendToCompanionWindow: vi.fn() }))
vi.mock('./companion-audio-output', () => ({ onAudioState: vi.fn(() => () => {}) }))
vi.mock('./companion-brain', () => ({ getCompanionBrain: vi.fn() }))
vi.mock('./companion-agent-watch', () => ({ takePendingDiscussionContext: vi.fn(() => null) }))
import {
  createCompanionDialogue,
  type CompanionDialogueBrain,
  type CompanionDialogueDeps,
  type CompanionDialogueTts
} from './companion-dialogue'
import type { CompanionAudioState, CompanionConversationState } from '../../shared/companion-types'

type BrainEvent = Parameters<Parameters<CompanionDialogueBrain['send']>[1]>[0]

type DeferredBrainTurn = {
  prompt: string
  emit: (event: BrainEvent) => void
  resolve: () => void
}

/** Mirrors `CompanionConversation`'s own guard (no transition once 'idle') closely enough
 *  for these tests: an over-permissive fake would hide a real reportX ordering bug. */
class FakeConversation {
  state: CompanionConversationState = 'idle'
  private listeners: ((state: CompanionConversationState) => void)[] = []

  getState(): CompanionConversationState {
    return this.state
  }

  private setState(next: CompanionConversationState): void {
    if (this.state === next) {
      return
    }
    this.state = next
    for (const listener of this.listeners) {
      listener(next)
    }
  }

  onStateChange(listener: (state: CompanionConversationState) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  start(): void {
    this.setState('listening')
  }

  stop(): void {
    this.setState('idle')
  }

  reportThinking(): void {
    if (this.state !== 'idle') {
      this.setState('thinking')
    }
  }

  reportListening(): void {
    if (this.state !== 'idle') {
      this.setState('listening')
    }
  }

  reportSpeaking(): void {
    if (this.state !== 'idle') {
      this.setState('speaking')
    }
  }
}

/** Queues deferred turns FIFO: `nextTurn()` called before `send()` waits for it, and vice versa. */
function fakeBrain(): {
  brain: CompanionDialogueBrain
  nextTurn: () => Promise<DeferredBrainTurn>
} {
  const readyTurns: DeferredBrainTurn[] = []
  const waitingResolvers: ((turn: DeferredBrainTurn) => void)[] = []
  const send = vi.fn((text: string, onEvent: Parameters<CompanionDialogueBrain['send']>[1]) => {
    const { promise, resolve } = Promise.withResolvers<void>()
    const turn: DeferredBrainTurn = { prompt: text, emit: onEvent, resolve }
    const waiter = waitingResolvers.shift()
    if (waiter) {
      waiter(turn)
    } else {
      readyTurns.push(turn)
    }
    return promise
  })
  const nextTurn = (): Promise<DeferredBrainTurn> => {
    const queued = readyTurns.shift()
    if (queued) {
      return Promise.resolve(queued)
    }
    const { promise, resolve } = Promise.withResolvers<DeferredBrainTurn>()
    waitingResolvers.push(resolve)
    return promise
  }
  return { brain: { send, reset: vi.fn() }, nextTurn }
}

function fakeTts(): { tts: CompanionDialogueTts; pushed: string[] } {
  const pushed: string[] = []
  const tts: CompanionDialogueTts = {
    speakStream: vi.fn(() => ({
      pushDelta: (text: string) => pushed.push(text),
      finish: vi.fn()
    })),
    speak: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn()
  }
  return { tts, pushed }
}

function buildHarness(overrides: Partial<CompanionDialogueDeps> = {}) {
  const conversation = new FakeConversation()
  let utteranceListeners: ((text: string) => void)[] = []
  let audioListeners: ((state: CompanionAudioState) => void)[] = []
  const { brain, nextTurn } = fakeBrain()
  const { tts, pushed } = fakeTts()
  const assistantDeltas: string[] = []
  const assistantFinals: string[] = []
  const assistantErrors: string[] = []
  const stateChanges: CompanionConversationState[] = []
  let uuidCounter = 0

  const deps: CompanionDialogueDeps = {
    conversation,
    onUtterance: (listener) => {
      utteranceListeners.push(listener)
      return () => {
        utteranceListeners = utteranceListeners.filter((l) => l !== listener)
      }
    },
    onStateChange: (listener) => conversation.onStateChange(listener),
    onAudioState: (listener) => {
      audioListeners.push(listener)
      return () => {
        audioListeners = audioListeners.filter((l) => l !== listener)
      }
    },
    brain,
    getTts: () => ({ service: tts, voice: 'eugene', rate: 1 }),
    sendAssistantDelta: (text) => assistantDeltas.push(text),
    sendAssistantFinal: (text) => assistantFinals.push(text),
    sendAssistantError: (message) => assistantErrors.push(message),
    sendStateChanged: (state) => stateChanges.push(state),
    takeDiscussionContext: () => null,
    randomUUID: () => `uuid-${(uuidCounter += 1)}`,
    ...overrides
  }

  const dialogue = createCompanionDialogue(deps)
  const emitUtterance = (text: string): void => {
    for (const listener of utteranceListeners) {
      listener(text)
    }
  }
  const emitAudioState = (state: CompanionAudioState): void => {
    for (const listener of audioListeners) {
      listener(state)
    }
  }

  return {
    conversation,
    dialogue,
    nextTurn,
    tts,
    pushed,
    assistantDeltas,
    assistantFinals,
    assistantErrors,
    stateChanges,
    emitUtterance,
    emitAudioState
  }
}

describe('createCompanionDialogue', () => {
  it('runs utterance -> thinking -> speaking -> listening for a streamed reply', async () => {
    const h = buildHarness()
    h.conversation.start()

    h.emitUtterance('привет')
    expect(h.conversation.getState()).toBe('thinking')

    const turn = await h.nextTurn()
    turn.emit({ type: 'delta', text: 'Привет' })
    turn.emit({ type: 'delta', text: ', Евгений' })
    turn.emit({ type: 'final', text: 'Привет, Евгений' })
    turn.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(h.assistantDeltas).toEqual(['Привет', ', Евгений'])
    expect(h.pushed).toEqual(['Привет', ', Евгений'])
    expect(h.assistantFinals).toEqual(['Привет, Евгений'])
    // Speaking only starts once the panel reports actual playback, not on stream finish.
    expect(h.conversation.getState()).toBe('thinking')

    h.emitAudioState({ utteranceId: 'uuid-1', state: 'playing' })
    expect(h.conversation.getState()).toBe('speaking')

    h.emitAudioState({ utteranceId: 'uuid-1', state: 'ended' })
    expect(h.conversation.getState()).toBe('listening')
    expect(h.stateChanges).toEqual(['listening', 'thinking', 'speaking', 'listening'])
  })

  it('reports speaking only while audio actually plays, and listening again once it stops', async () => {
    const h = buildHarness()
    h.conversation.start()
    h.emitUtterance('что там у агентов')
    const turn = await h.nextTurn()
    turn.emit({ type: 'final', text: 'Всё готово' })
    turn.resolve()
    await Promise.resolve()

    expect(h.conversation.getState()).toBe('thinking')
    h.emitAudioState({ utteranceId: 'uuid-1', state: 'playing' })
    expect(h.conversation.getState()).toBe('speaking')
    h.emitAudioState({ utteranceId: 'uuid-1', state: 'stopped' })
    expect(h.conversation.getState()).toBe('listening')
  })

  it('goes straight back to listening when TTS is unavailable (no audio-state ever arrives)', async () => {
    const h = buildHarness({ getTts: () => null })
    h.conversation.start()
    h.emitUtterance('привет')
    const turn = await h.nextTurn()
    turn.emit({ type: 'final', text: 'Привет' })
    turn.resolve()
    await Promise.resolve()
    expect(h.conversation.getState()).toBe('listening')
  })

  it('barge-in stops audio immediately and returns to listening without resetting the brain', async () => {
    const h = buildHarness()
    h.conversation.start()
    h.emitUtterance('расскажи подробнее')
    const turn = await h.nextTurn()
    turn.emit({ type: 'final', text: 'Подробности...' })
    turn.resolve()
    await Promise.resolve()
    h.emitAudioState({ utteranceId: 'uuid-1', state: 'playing' })
    expect(h.conversation.getState()).toBe('speaking')

    h.dialogue.bargeIn()

    expect(h.conversation.getState()).toBe('listening')
    expect(h.tts.stop).toHaveBeenCalledWith('uuid-1')
    expect(h.tts.speak).not.toHaveBeenCalled()
  })

  it('barge-in is a no-op outside the speaking state', () => {
    const h = buildHarness()
    h.conversation.start()
    h.dialogue.bargeIn()
    expect(h.conversation.getState()).toBe('listening')
    expect(h.tts.stop).not.toHaveBeenCalled()
  })

  it('the brain error path speaks a brief phrase and surfaces the full message in the panel', async () => {
    const h = buildHarness()
    h.conversation.start()
    h.emitUtterance('сломай всё')
    const turn = await h.nextTurn()
    turn.emit({ type: 'error', message: 'connection reset' })
    turn.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(h.assistantErrors).toEqual(['connection reset'])
    expect(h.conversation.getState()).toBe('listening')
    expect(h.tts.speak).toHaveBeenCalledWith(
      'Извините, не получилось ответить.',
      expect.any(Object)
    )
  })

  it('prepends the discussion context to the first turn of a freshly opened conversation only', async () => {
    let context: { text: string } | null = { text: 'Агент А закончил ревью.' }
    const h = buildHarness({ takeDiscussionContext: () => context })
    h.conversation.start()

    h.emitUtterance('что там')
    const firstTurn = await h.nextTurn()
    expect(firstTurn.prompt).toBe('Агент А закончил ревью.\n\nчто там')
    firstTurn.emit({ type: 'final', text: 'ok' })
    firstTurn.resolve()
    await Promise.resolve()
    h.emitAudioState({ utteranceId: 'uuid-1', state: 'ended' })

    context = null
    h.emitUtterance('а дальше?')
    const secondTurn = await h.nextTurn()
    expect(secondTurn.prompt).toBe('а дальше?')
    secondTurn.emit({ type: 'final', text: 'ok2' })
    secondTurn.resolve()
    await Promise.resolve()

    expect(h.assistantFinals).toEqual(['ok', 'ok2'])
  })

  it('does not prepend discussion context to a plain hotkey-opened conversation', async () => {
    const h = buildHarness({ takeDiscussionContext: () => null })
    h.conversation.start()
    h.emitUtterance('привет')
    const turn = await h.nextTurn()
    expect(turn.prompt).toBe('привет')
    turn.emit({ type: 'final', text: 'ok' })
    turn.resolve()
  })

  it('a stop phrase closing the conversation stops any in-flight audio', async () => {
    const h = buildHarness()
    h.conversation.start()
    h.emitUtterance('расскажи')
    const turn = await h.nextTurn()
    turn.emit({ type: 'final', text: 'Ладно...' })
    turn.resolve()
    await Promise.resolve()
    h.emitAudioState({ utteranceId: 'uuid-1', state: 'playing' })
    expect(h.conversation.getState()).toBe('speaking')

    h.conversation.stop()

    expect(h.conversation.getState()).toBe('idle')
    expect(h.tts.stop).toHaveBeenCalled()
  })

  it('resetConversation drops the brain session and stops audio without touching conversation state', async () => {
    const h = buildHarness()
    h.conversation.start()

    h.dialogue.resetConversation()

    expect(h.tts.stop).toHaveBeenCalled()
    expect(h.conversation.getState()).toBe('listening')
  })
})
