// omp background jobs → `background-task` blocks. omp reports each job's lifecycle in
// record `details`: a spawn (`task` → `progress[]`), a backgrounded shell (`async`), and
// job snapshots (`wait` results and `async-result` delivery notices → `jobs[]`). Each
// snapshot is a block keyed by the job id; the reader keeps the newest one per job.

import type { NativeChatBackgroundTaskBlock } from '../../shared/native-chat-types'
import { asRecord, extractString } from '../ai-vault/session-scanner-values'

type JobBlock = NativeChatBackgroundTaskBlock

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'error',
  'cancelled',
  'canceled',
  'aborted',
  'killed',
  'timeout'
])

function jobKind(type: string | null): JobBlock['kind'] {
  return type === 'task' ? 'agent' : type === 'bash' ? 'command' : 'unknown'
}

function jobState(status: string | null): JobBlock['state'] {
  if (status === 'completed') {
    return 'done'
  }
  // A failed or cancelled job is over but did not finish its work.
  return status && TERMINAL_STATUSES.has(status) ? 'idle' : 'working'
}

function snapshotBlock(job: Record<string, unknown>, timestamp: number | null): JobBlock | null {
  const taskId = extractString(job.id) ?? extractString(job.jobId)
  if (!taskId) {
    return null
  }
  const status = extractString(job.status)
  const durationMs = typeof job.durationMs === 'number' ? job.durationMs : null
  const terminal = status !== null && TERMINAL_STATUSES.has(status)
  return {
    type: 'background-task',
    taskId,
    kind: jobKind(extractString(job.type)),
    label: extractString(job.label) ?? taskId,
    state: jobState(status),
    ...(timestamp !== null && durationMs !== null ? { startedAt: timestamp - durationMs } : {}),
    ...(terminal && timestamp !== null ? { settledAt: timestamp } : {})
  }
}

/** The background-job snapshots one omp record's `details` carries. A spawn or backgrounded
 *  shell names the tool call that started it, whose input says what the job runs. */
export function ompBackgroundJobBlocks(
  details: unknown,
  timestamp: number | null,
  parentToolUseId?: string
): JobBlock[] {
  const record = asRecord(details)
  if (!record) {
    return []
  }
  const blocks: JobBlock[] = []
  const pushStart = (taskId: string, kind: JobBlock['kind'], status: string | null): void => {
    blocks.push({
      type: 'background-task',
      taskId,
      kind,
      label: taskId,
      state: jobState(status),
      ...(parentToolUseId ? { parentToolUseId } : {}),
      ...(timestamp !== null ? { startedAt: timestamp } : {})
    })
  }
  for (const entry of Array.isArray(record.progress) ? record.progress : []) {
    const agent = asRecord(entry)
    const taskId = extractString(agent?.id)
    if (agent && taskId) {
      pushStart(taskId, 'agent', extractString(agent.status))
    }
  }
  const async = asRecord(record.async)
  const asyncJobId = extractString(async?.jobId)
  if (async && asyncJobId) {
    pushStart(asyncJobId, jobKind(extractString(async.type)), extractString(async.state))
  }
  for (const entry of Array.isArray(record.jobs) ? record.jobs : []) {
    const job = asRecord(entry)
    const block = job ? snapshotBlock(job, timestamp) : null
    if (block) {
      blocks.push(block)
    }
  }
  return blocks
}
