// ─── WorkspaceCheckState construction for the workspace-check engine ────────
import type { WorkspaceCheckState } from '../../shared/workspace-check-types'
import type { WorkspaceCheckRunOutcome } from './workspace-check-command-runner'

export function buildRunningWorkspaceCheckState(
  worktreeId: string,
  command: string,
  startedAt: number
): WorkspaceCheckState {
  return {
    worktreeId,
    command,
    status: 'running',
    exitCode: null,
    error: null,
    timedOut: false,
    startedAt,
    finishedAt: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false
  }
}

export function buildFinishedWorkspaceCheckState(
  worktreeId: string,
  outcome: WorkspaceCheckRunOutcome
): WorkspaceCheckState {
  const passed = !outcome.timedOut && !outcome.error && outcome.exitCode === 0
  return {
    worktreeId,
    command: outcome.command,
    status: passed ? 'passed' : 'failed',
    exitCode: outcome.exitCode,
    error: outcome.error,
    timedOut: outcome.timedOut,
    startedAt: outcome.startedAt,
    finishedAt: outcome.completedAt,
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    stdoutTruncated: outcome.stdoutTruncated,
    stderrTruncated: outcome.stderrTruncated
  }
}

export function buildFailedResolutionWorkspaceCheckState(args: {
  worktreeId: string
  command: string
  error: string
  startedAt: number
  finishedAt: number
}): WorkspaceCheckState {
  return {
    worktreeId: args.worktreeId,
    command: args.command,
    status: 'failed',
    exitCode: null,
    error: args.error,
    timedOut: false,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false
  }
}
