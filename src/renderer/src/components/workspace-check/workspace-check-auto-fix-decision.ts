import type { WorkspaceCheckRunStatus } from '../../../../shared/workspace-check-types'
import type { AgentStatusState } from '../../../../shared/agent-status-types'

// ─── Pure state machine: per-worktree workspace-check auto-fix decision ────
// No store/IPC access here so every branch is exhaustively unit-testable; the
// subscriber (workspace-check-auto-fix.ts) owns the per-worktree bookkeeping
// (last processed finishedAt, attempt count, whether the limit toast already
// fired) and interprets the returned action.

export const WORKSPACE_CHECK_AUTO_FIX_MAX_ATTEMPTS = 3
export const WORKSPACE_CHECK_AUTO_FIX_OUTPUT_TAIL_CHARS = 4000

export type WorkspaceCheckAutoFixAgentPane = {
  paneKey: string
  state: AgentStatusState
  stateStartedAt: number
}

export type WorkspaceCheckAutoFixResult = {
  status: WorkspaceCheckRunStatus
  exitCode: number | null
  error: string | null
  finishedAt: number | null
}

export type WorkspaceCheckAutoFixDecisionInput = {
  result: WorkspaceCheckAutoFixResult
  /** `finishedAt` of the last result this worktree already reacted to; dedupes
   *  re-delivery of the same push event. */
  lastProcessedFinishedAt: number | null
  repoCheckAutoFix: boolean
  /** Consecutive auto-fix prompts already sent for this worktree since its last pass. */
  attemptCount: number
  agentPanes: readonly WorkspaceCheckAutoFixAgentPane[]
}

export type WorkspaceCheckAutoFixAction =
  | { type: 'ignore' }
  | { type: 'reset-attempts'; finishedAt: number }
  | { type: 'limit-reached'; finishedAt: number }
  | { type: 'submit-prompt'; finishedAt: number; paneKey: string }

export function decideWorkspaceCheckAutoFix(
  input: WorkspaceCheckAutoFixDecisionInput
): WorkspaceCheckAutoFixAction {
  const { result } = input
  if (result.finishedAt === null || result.finishedAt === input.lastProcessedFinishedAt) {
    return { type: 'ignore' }
  }
  if (result.status === 'passed') {
    return input.attemptCount > 0
      ? { type: 'reset-attempts', finishedAt: result.finishedAt }
      : { type: 'ignore' }
  }
  if (result.status !== 'failed') {
    return { type: 'ignore' }
  }
  // The process never ran (e.g. SSH disconnected, timeout before spawn): not a
  // real check failure, so it must not count against the agent or the attempt limit.
  if (result.exitCode === null && result.error) {
    return { type: 'ignore' }
  }
  if (!input.repoCheckAutoFix) {
    return { type: 'ignore' }
  }
  if (input.attemptCount >= WORKSPACE_CHECK_AUTO_FIX_MAX_ATTEMPTS) {
    return { type: 'limit-reached', finishedAt: result.finishedAt }
  }
  if (input.agentPanes.some((pane) => pane.state === 'working' || pane.state === 'waiting')) {
    return { type: 'ignore' }
  }
  let target: WorkspaceCheckAutoFixAgentPane | null = null
  for (const pane of input.agentPanes) {
    if (pane.state === 'done' && (!target || pane.stateStartedAt > target.stateStartedAt)) {
      target = pane
    }
  }
  if (!target) {
    return { type: 'ignore' }
  }
  return { type: 'submit-prompt', finishedAt: result.finishedAt, paneKey: target.paneKey }
}

export function buildWorkspaceCheckAutoFixPrompt(args: {
  command: string
  exitCode: number | null
  output: string
}): string {
  const tail = args.output.slice(-WORKSPACE_CHECK_AUTO_FIX_OUTPUT_TAIL_CHARS)
  return `The workspace check \`${args.command}\` failed (exit ${args.exitCode ?? 'unknown'}). Fix the cause, then stop.\n\n\`\`\`\n${tail}\n\`\`\``
}
