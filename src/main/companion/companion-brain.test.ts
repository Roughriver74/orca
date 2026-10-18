import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type {
  ClaudeStreamJsonConnection,
  ClaudeStreamJsonConnectionHandlers,
  ClaudeStreamJsonLaunch
} from '../claude/claude-stream-json-connection'
import {
  CompanionBrain,
  getCompanionBrain,
  resetCompanionBrainForTests,
  resolveCompanionHomeDir,
  type CompanionBrainDeps,
  type CompanionBrainEvent
} from './companion-brain'

type OpenedConnection = {
  launch: ClaudeStreamJsonLaunch
  handlers: ClaudeStreamJsonConnectionHandlers
  sent: Record<string, unknown>[]
  closed: boolean
  connection: ClaudeStreamJsonConnection
}

function fakeOpenConnection(): {
  openConnection: CompanionBrainDeps['openConnection']
  opened: OpenedConnection[]
} {
  const opened: OpenedConnection[] = []
  const openConnection = vi.fn(
    async (
      launch: ClaudeStreamJsonLaunch,
      handlers: ClaudeStreamJsonConnectionHandlers = {}
    ): Promise<ClaudeStreamJsonConnection> => {
      const sent: Record<string, unknown>[] = []
      const record: OpenedConnection = {
        launch,
        handlers,
        sent,
        closed: false,
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fake only exercises `send`/`close`; the other ClaudeStreamJsonConnection members are never read.
        connection: null as unknown as ClaudeStreamJsonConnection
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the real connection also carries ClaudeControlSurface members this test never calls.
      record.connection = {
        pid: 1,
        closed: false,
        exitVerdict: { root: 'exited', tree: 'exited' },
        send: vi.fn(async (message: Record<string, unknown>) => {
          sent.push(message)
        }),
        close: vi.fn(async () => {
          record.closed = true
          return true
        })
      } as unknown as ClaudeStreamJsonConnection
      opened.push(record)
      return record.connection
    }
  )
  return { openConnection, opened }
}

function textDelta(text: string): Record<string, unknown> {
  return {
    type: 'stream_event',
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    parent_tool_use_id: null
  }
}

function resultFrame(text: string, isError = false): Record<string, unknown> {
  return {
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    result: text,
    is_error: isError,
    parent_tool_use_id: null
  }
}

describe('resolveCompanionHomeDir', () => {
  it('resolves an empty/unset home dir to ~/assistant', () => {
    expect(resolveCompanionHomeDir(undefined)).toBe(join(homedir(), 'assistant'))
    expect(resolveCompanionHomeDir('')).toBe(join(homedir(), 'assistant'))
    expect(resolveCompanionHomeDir('   ')).toBe(join(homedir(), 'assistant'))
  })

  it('keeps an explicit home dir', () => {
    expect(resolveCompanionHomeDir('/custom/home')).toBe('/custom/home')
  })
})

describe('CompanionBrain', () => {
  it('streams deltas then resolves the turn with the result frame text', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })
    const events: CompanionBrainEvent[] = []

    const sendPromise = brain.send('Привет', (event) => events.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    const [first] = opened
    first.handlers.onMessage?.(textDelta('При'))
    first.handlers.onMessage?.(textDelta('вет!'))
    first.handlers.onMessage?.(resultFrame('Привет!'))
    await sendPromise

    expect(events).toEqual([
      { type: 'delta', text: 'При' },
      { type: 'delta', text: 'вет!' },
      { type: 'final', text: 'Привет!' }
    ])
    expect(first.sent).toHaveLength(1)
    expect(first.sent[0]).toMatchObject({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Привет' }] },
      parent_tool_use_id: null
    })
    expect(first.launch.cwd).toBe('/home/assistant')
  })

  it('ignores subagent frames (a string parent_tool_use_id) when tracking the root turn', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })
    const events: CompanionBrainEvent[] = []

    const sendPromise = brain.send('Хай', (event) => events.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    const [first] = opened
    first.handlers.onMessage?.({
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'subagent noise' } },
      parent_tool_use_id: 'toolu_1'
    })
    first.handlers.onMessage?.({
      type: 'result',
      subtype: 'success',
      result: 'child done',
      is_error: false,
      parent_tool_use_id: 'toolu_1'
    })
    first.handlers.onMessage?.(resultFrame('root reply'))
    await sendPromise

    expect(events).toEqual([{ type: 'final', text: 'root reply' }])
  })

  it('surfaces an is_error result frame as an error event', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })
    const events: CompanionBrainEvent[] = []

    const sendPromise = brain.send('ping', (event) => events.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]!.handlers.onMessage?.(resultFrame('boom', true))
    await sendPromise

    expect(events).toEqual([{ type: 'error', message: 'boom' }])
  })

  it('surfaces a mid-turn connection fault as an error event and resolves send()', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })
    const events: CompanionBrainEvent[] = []

    const sendPromise = brain.send('ping', (event) => events.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]!.handlers.onFault?.(new Error('child crashed'))
    await sendPromise

    expect(events).toEqual([{ type: 'error', message: 'child crashed' }])
  })

  it('surfaces a failed connection open as an error event rather than throwing', async () => {
    const openConnection = vi.fn(async () => {
      throw new Error('claude executable missing')
    })
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `CompanionBrainDeps['openConnection']` is a throwing async fn here; the real signature's extra optional params are never read by this test.
      openConnection: openConnection as never,
      resolveCommand: () => 'claude'
    })
    const events: CompanionBrainEvent[] = []

    await expect(brain.send('ping', (event) => events.push(event))).resolves.toBeUndefined()
    expect(events).toEqual([{ type: 'error', message: 'claude executable missing' }])
  })

  it('reuses one connection and session id across sends, until reset() starts a fresh one', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })

    const firstSend = brain.send('one', () => undefined)
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]!.handlers.onMessage?.(resultFrame('ok'))
    await firstSend

    const secondSend = brain.send('two', () => undefined)
    await vi.waitFor(() => expect(opened[0]!.sent).toHaveLength(2))
    opened[0]!.handlers.onMessage?.(resultFrame('ok two'))
    await secondSend
    // Why asserted after the second send (not with a timing wait): opening is synchronous once
    // queued, so no second connection ever appears if the brain is correctly reusing the first.
    expect(opened).toHaveLength(1)
    expect(opened[0]!.sent[1]).toMatchObject({ session_id: opened[0]!.launch.options.sessionId })

    brain.reset()
    await vi.waitFor(() => expect(opened[0]!.closed).toBe(true))

    const thirdSend = brain.send('three', () => undefined)
    await vi.waitFor(() => expect(opened).toHaveLength(2))
    opened[1]!.handlers.onMessage?.(resultFrame('ok again'))
    await thirdSend

    expect(opened[1]!.launch.options.sessionId).not.toBe(opened[0]!.launch.options.sessionId)
  })

  it('ignores the old connection exiting after reset() while the next turn runs', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })

    const firstSend = brain.send('one', () => undefined)
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]!.handlers.onMessage?.(resultFrame('ok'))
    await firstSend

    brain.reset()
    const events: { type: string }[] = []
    const nextSend = brain.send('two', (event) => events.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(2))
    // The killed child reports its SIGTERM only after the fresh child is already serving.
    opened[0]!.handlers.onExit?.(new Error('claude stream-json exited (signal SIGTERM)'))
    opened[0]!.handlers.onMessage?.(resultFrame('stale reply'))
    opened[1]!.handlers.onMessage?.(resultFrame('fresh reply'))
    await nextSend

    expect(events).toEqual([{ type: 'final', text: 'fresh reply' }])
  })

  it('serializes overlapping sends so their events never interleave', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'sonnet', {
      openConnection,
      resolveCommand: () => 'claude'
    })
    const firstEvents: CompanionBrainEvent[] = []
    const secondEvents: CompanionBrainEvent[] = []

    const firstSend = brain.send('one', (event) => firstEvents.push(event))
    const secondSend = brain.send('two', (event) => secondEvents.push(event))
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    expect(opened[0]!.sent).toHaveLength(1)

    opened[0]!.handlers.onMessage?.(resultFrame('first done'))
    await firstSend
    await vi.waitFor(() => expect(opened[0]!.sent).toHaveLength(2))
    opened[0]!.handlers.onMessage?.(resultFrame('second done'))
    await secondSend

    expect(firstEvents).toEqual([{ type: 'final', text: 'first done' }])
    expect(secondEvents).toEqual([{ type: 'final', text: 'second done' }])
  })

  it('launches the connection with the configured model', async () => {
    const { openConnection, opened } = fakeOpenConnection()
    const brain = new CompanionBrain('/home/assistant', 'opus', {
      openConnection,
      resolveCommand: () => 'claude'
    })

    const sendPromise = brain.send('ping', () => undefined)
    await vi.waitFor(() => expect(opened).toHaveLength(1))
    opened[0]!.handlers.onMessage?.(resultFrame('pong'))
    await sendPromise

    expect(opened[0]!.launch.options.model).toBe('opus')
  })
})

describe('getCompanionBrain', () => {
  it('reads the home dir from the settings store once, then returns the same instance', () => {
    resetCompanionBrainForTests()
    const getSettings = vi.fn(() => ({ companion: { homeDir: '/configured/home' } }))
    const first = getCompanionBrain({ getSettings })
    const second = getCompanionBrain({ getSettings })
    expect(first).toBe(second)
    expect(getSettings).toHaveBeenCalledTimes(1)
  })
})
