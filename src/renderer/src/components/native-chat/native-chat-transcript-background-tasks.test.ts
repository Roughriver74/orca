import { describe, expect, it } from 'vitest'
import type {
  NativeChatBackgroundTaskBlock,
  NativeChatMessage
} from '../../../../shared/native-chat-types'
import { foldNativeChatTranscriptBackgroundTasks } from './native-chat-transcript-background-tasks'

const job = (
  taskId: string,
  fields: Partial<NativeChatBackgroundTaskBlock> = {}
): NativeChatBackgroundTaskBlock => ({
  type: 'background-task',
  taskId,
  kind: 'command',
  label: taskId,
  state: 'working',
  ...fields
})

const result = (id: string, ...jobs: NativeChatBackgroundTaskBlock[]): NativeChatMessage => ({
  id,
  role: 'tool',
  blocks: [{ type: 'tool-result', output: 'ok' }, ...jobs],
  timestamp: 1,
  source: 'transcript'
})

const call = (id: string, callId: string, command: string): NativeChatMessage => ({
  id,
  role: 'assistant',
  blocks: [{ type: 'tool-call', name: 'bash', input: { command, async: true }, callId }],
  timestamp: 1,
  source: 'transcript'
})

describe('foldNativeChatTranscriptBackgroundTasks', () => {
  it('returns the transcript untouched when no job was reported', () => {
    const messages = [call('a', 'c1', 'ls'), result('r')]
    const folded = foldNativeChatTranscriptBackgroundTasks(messages)
    expect(folded.messages).toBe(messages)
    expect(folded.tasks).toEqual([])
  })

  it('keeps the newest snapshot per job and takes the snapshots out of the transcript', () => {
    const messages = [
      call('a1', 'c1', 'npm run build'),
      result('r1', job('bg_1', { parentToolUseId: 'c1', startedAt: 100 })),
      result('r2', job('agent-1', { kind: 'agent', label: 'Scout', startedAt: 200 })),
      result(
        'r3',
        job('bg_1', { state: 'done', startedAt: 100, settledAt: 300 }),
        job('agent-1', { kind: 'agent', label: 'Scout', startedAt: 200 })
      )
    ]
    const folded = foldNativeChatTranscriptBackgroundTasks(messages)

    expect(folded.tasks).toEqual([
      {
        id: 'agent-1',
        kind: 'agent',
        description: 'Scout',
        state: 'working',
        startedAt: 200,
        stoppable: false
      }
    ])
    // The shell's start row knew only its id; the call that started it names the command.
    expect(folded.settledTasks).toMatchObject([
      { id: 'bg_1', description: 'npm run build', state: 'done' }
    ])
    expect(folded.messages.flatMap((message) => message.blocks.map((block) => block.type))).toEqual(
      ['tool-call', 'tool-result', 'tool-result', 'tool-result']
    )
    expect(folded.messages[0]).toBe(messages[0])
  })

  it('shows nothing once every job has settled', () => {
    const folded = foldNativeChatTranscriptBackgroundTasks([
      result('r1', job('bg_1', { startedAt: 100 })),
      result('r2', job('bg_1', { state: 'done', settledAt: 200 }))
    ])
    expect(folded.tasks).toEqual([])
    expect(folded.settledTasks).toEqual([])
  })

  it('drops a job that settled before the live work started from the settled list', () => {
    const folded = foldNativeChatTranscriptBackgroundTasks([
      result('r1', job('old', { state: 'done', startedAt: 10, settledAt: 50 })),
      result('r2', job('new', { startedAt: 100 }))
    ])
    expect(folded.tasks.map((task) => task.id)).toEqual(['new'])
    expect(folded.settledTasks).toEqual([])
  })

  it('reuses the stripped row object across folds so memoized rows stay put', () => {
    const messages = [result('r1', job('bg_1'))]
    const first = foldNativeChatTranscriptBackgroundTasks(messages).messages[0]
    expect(foldNativeChatTranscriptBackgroundTasks([...messages]).messages[0]).toBe(first)
  })
})
