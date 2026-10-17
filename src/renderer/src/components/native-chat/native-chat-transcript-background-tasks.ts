// A terminal agent's transcript reports background jobs as snapshots (a spawn, then
// progress and delivery notices). Fold them per job into one roster for the strip above
// the composer, and take them out of the transcript, where each snapshot would draw a
// row frozen at the state it reported.

import type { AgentSessionBackgroundTask } from '../../../../shared/agent-session-wire'
import type {
  NativeChatBackgroundTaskBlock,
  NativeChatMessage
} from '../../../../shared/native-chat-types'

export type NativeChatTranscriptBackgroundTasks = {
  messages: NativeChatMessage[]
  tasks: AgentSessionBackgroundTask[]
  settledTasks: AgentSessionBackgroundTask[]
}

type FoldedJob = NativeChatBackgroundTaskBlock & { order: number }

const NO_TASKS: AgentSessionBackgroundTask[] = []
// Why: memoized transcript rows re-render on a new message object; keep one per source row.
const strippedRows = new WeakMap<NativeChatMessage, NativeChatMessage | null>()

function withoutJobBlocks(message: NativeChatMessage): NativeChatMessage | null {
  const cached = strippedRows.get(message)
  if (cached !== undefined) {
    return cached
  }
  const blocks = message.blocks.filter((block) => block.type !== 'background-task')
  const stripped = blocks.length > 0 ? { ...message, blocks } : null
  strippedRows.set(message, stripped)
  return stripped
}

/** What a backgrounded shell runs, read from the tool call that started it. */
function commandOf(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || !('command' in input)) {
    return null
  }
  return typeof input.command === 'string' && input.command.trim() ? input.command.trim() : null
}

function mergeJob(prior: FoldedJob | undefined, next: NativeChatBackgroundTaskBlock): FoldedJob {
  if (!prior) {
    return { ...next, order: 0 }
  }
  const startedAt =
    prior.startedAt !== undefined && next.startedAt !== undefined
      ? Math.min(prior.startedAt, next.startedAt)
      : (prior.startedAt ?? next.startedAt)
  return {
    ...prior,
    ...next,
    // A start row only knows the job id; keep the first real name any snapshot gave.
    label: next.label !== next.taskId ? next.label : prior.label,
    parentToolUseId: prior.parentToolUseId ?? next.parentToolUseId,
    ...(startedAt !== undefined ? { startedAt } : {}),
    order: prior.order
  }
}

function toTask(job: FoldedJob, commands: ReadonlyMap<string, string>): AgentSessionBackgroundTask {
  const command =
    job.label === job.taskId && job.parentToolUseId ? commands.get(job.parentToolUseId) : undefined
  return {
    id: job.taskId,
    kind: job.kind,
    description: command ?? job.label,
    state: job.state,
    ...(job.startedAt !== undefined ? { startedAt: job.startedAt } : {}),
    stoppable: false
  }
}

export function foldNativeChatTranscriptBackgroundTasks(
  messages: NativeChatMessage[]
): NativeChatTranscriptBackgroundTasks {
  const jobs = new Map<string, FoldedJob>()
  const commands = new Map<string, string>()
  let stripped: NativeChatMessage[] | null = null
  messages.forEach((message, index) => {
    let hasJobs = false
    for (const block of message.blocks) {
      if (block.type === 'background-task') {
        hasJobs = true
        const folded = mergeJob(jobs.get(block.taskId), block)
        jobs.set(block.taskId, jobs.has(block.taskId) ? folded : { ...folded, order: jobs.size })
      } else if (block.type === 'tool-call' && block.callId) {
        const command = commandOf(block.input)
        if (command) {
          commands.set(block.callId, command)
        }
      }
    }
    if (!hasJobs) {
      stripped?.push(message)
      return
    }
    stripped ??= messages.slice(0, index)
    const row = withoutJobBlocks(message)
    if (row) {
      stripped.push(row)
    }
  })
  if (jobs.size === 0) {
    return { messages, tasks: NO_TASKS, settledTasks: NO_TASKS }
  }
  const ordered = [...jobs.values()].sort((left, right) => left.order - right.order)
  const live = ordered.filter((job) => job.state === 'working')
  // Settled siblings stay listed only beside live work that was running when they ended.
  const liveSince = Math.min(...live.map((job) => job.startedAt ?? Number.POSITIVE_INFINITY))
  const settled = ordered.filter(
    (job) => job.state !== 'working' && live.length > 0 && (job.settledAt ?? 0) >= liveSince
  )
  return {
    messages: stripped ?? messages,
    tasks: live.length > 0 ? live.map((job) => toTask(job, commands)) : NO_TASKS,
    settledTasks: settled.length > 0 ? settled.map((job) => toTask(job, commands)) : NO_TASKS
  }
}
