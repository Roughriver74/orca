import { describe, expect, it } from 'vitest'
import { decodeOmpTranscriptLine } from './transcript-line-decoders'

const AT = '2026-10-17T11:26:15.383Z'
const AT_MS = Date.parse(AT)

const toolResult = (toolName: string, details: unknown, toolCallId = 'call-1'): string =>
  JSON.stringify({
    type: 'message',
    id: 'rec-1',
    timestamp: AT,
    message: { role: 'toolResult', toolCallId, toolName, content: [], details }
  })

const jobBlocks = (line: string) =>
  decodeOmpTranscriptLine(line, 'f')?.blocks.filter((block) => block.type === 'background-task')

describe('omp background jobs', () => {
  it('reports a spawned subagent as a working agent tied to its task call', () => {
    const line = toolResult('task', {
      progress: [{ index: 0, id: 'OporaDemoStand', agent: 'task', status: 'pending' }]
    })
    expect(jobBlocks(line)).toEqual([
      {
        type: 'background-task',
        taskId: 'OporaDemoStand',
        kind: 'agent',
        label: 'OporaDemoStand',
        state: 'working',
        parentToolUseId: 'call-1',
        startedAt: AT_MS
      }
    ])
  })

  it('reports a backgrounded shell as a working command', () => {
    const line = toolResult('bash', { async: { state: 'running', jobId: 'bg_2', type: 'bash' } })
    expect(jobBlocks(line)).toMatchObject([
      { taskId: 'bg_2', kind: 'command', state: 'working', parentToolUseId: 'call-1' }
    ])
  })

  it('reads every job a wait snapshot lists, timing each from its duration', () => {
    const line = toolResult('wait', {
      op: 'wait',
      jobs: [
        { id: 'bg_2', type: 'bash', status: 'completed', label: 'scp config', durationMs: 5_000 },
        { id: 'OporaDemoStand', type: 'task', status: 'running', durationMs: 60_000 },
        { id: 'bg_3', type: 'bash', status: 'failed', label: 'find demo.yaml', durationMs: 1_000 }
      ]
    })
    expect(jobBlocks(line)).toEqual([
      expect.objectContaining({
        taskId: 'bg_2',
        label: 'scp config',
        state: 'done',
        startedAt: AT_MS - 5_000,
        settledAt: AT_MS
      }),
      expect.objectContaining({ taskId: 'OporaDemoStand', kind: 'agent', state: 'working' }),
      // A failed job is over without having finished its work.
      expect.objectContaining({ taskId: 'bg_3', state: 'idle', settledAt: AT_MS })
    ])
  })

  it('settles a job from its delivery notice and keeps the notice text', () => {
    const decoded = decodeOmpTranscriptLine(
      JSON.stringify({
        type: 'custom_message',
        id: 'rec-n',
        customType: 'async-result',
        display: true,
        timestamp: AT,
        content: 'Background job OporaVisitScout has completed.',
        details: {
          jobs: [
            {
              jobId: 'OporaVisitScout',
              type: 'task',
              status: 'completed',
              label: 'OporaVisitScout',
              durationMs: 111_438
            }
          ]
        }
      }),
      'f'
    )
    expect(decoded?.blocks).toEqual([
      { type: 'text', text: 'Background job OporaVisitScout has completed.' },
      expect.objectContaining({ taskId: 'OporaVisitScout', state: 'done', settledAt: AT_MS })
    ])
  })

  it('adds nothing to an ordinary tool result', () => {
    expect(jobBlocks(toolResult('read', { truncated: false }))).toEqual([])
  })
})
