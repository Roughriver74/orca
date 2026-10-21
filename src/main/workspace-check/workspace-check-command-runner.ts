// ─── Cancellable shell execution for the per-workspace "Check command" ──────
// Mirrors ../automations/precheck-runner.ts (same real-shell precedent: `child_process.spawn`
// with `shell: true`, SSH via an exec'd ClientChannel) but adds cancellation — the agent
// resuming `working` mid-run must be able to tear a run down instead of waiting it out — and
// uses this feature's own constants/result type, decoupled from the automations module.
import { spawn } from 'node:child_process'
import type { ClientChannel } from 'ssh2'
import {
  WORKSPACE_CHECK_MAX_OUTPUT_CHARS,
  WORKSPACE_CHECK_TIMEOUT_SECONDS
} from '../../shared/workspace-check-types'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { quotePosixShell } from '../../shared/shell-argument-quoting'
import { killLocalPrecheckProcessTree } from '../automations/precheck-runner'

export type WorkspaceCheckExecutionTarget =
  | { type: 'local'; cwd: string }
  | { type: 'ssh'; cwd: string; connectionId: string }

export type WorkspaceCheckRunOutcome = {
  command: string
  exitCode: number | null
  timedOut: boolean
  error: string | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  startedAt: number
  completedAt: number
}

type TailBuffer = {
  content: string
  truncated: boolean
}

function appendTail(buffer: TailBuffer, chunk: string): TailBuffer {
  const content = `${buffer.content}${chunk}`
  if (content.length <= WORKSPACE_CHECK_MAX_OUTPUT_CHARS) {
    return { ...buffer, content }
  }
  return {
    content: content.slice(-WORKSPACE_CHECK_MAX_OUTPUT_CHARS),
    truncated: true
  }
}

function createOutcome(args: {
  command: string
  startedAt: number
  stdout: TailBuffer
  stderr: TailBuffer
  exitCode: number | null
  timedOut: boolean
  error: string | null
}): WorkspaceCheckRunOutcome {
  return {
    command: args.command,
    exitCode: args.exitCode,
    timedOut: args.timedOut,
    error: args.error,
    stdout: args.stdout.content,
    stderr: args.stderr.content,
    stdoutTruncated: args.stdout.truncated,
    stderrTruncated: args.stderr.truncated,
    startedAt: args.startedAt,
    completedAt: Date.now()
  }
}

function startLocalWorkspaceCheck(
  command: string,
  target: Extract<WorkspaceCheckExecutionTarget, { type: 'local' }>
): { result: Promise<WorkspaceCheckRunOutcome>; cancel: () => void } {
  const startedAt = Date.now()
  const timeoutMs = WORKSPACE_CHECK_TIMEOUT_SECONDS * 1000
  let stdout: TailBuffer = { content: '', truncated: false }
  let stderr: TailBuffer = { content: '', truncated: false }
  let timedOut = false
  let cancelled = false
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | null = null
  let forceKillTimer: ReturnType<typeof setTimeout> | null = null

  const child = spawn(command, {
    cwd: target.cwd,
    detached: process.platform !== 'win32',
    env: process.env,
    shell: true,
    windowsHide: true
  })

  const result = new Promise<WorkspaceCheckRunOutcome>((resolve) => {
    const settle = (exitCode: number | null, error: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer)
        forceKillTimer = null
      }
      resolve(createOutcome({ command, startedAt, stdout, stderr, exitCode, timedOut, error }))
    }

    timeout = setTimeout(() => {
      timedOut = true
      forceKillTimer = killLocalPrecheckProcessTree(child)
    }, timeoutMs)

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = appendTail(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: string) => {
      stderr = appendTail(stderr, chunk)
    })
    child.on('error', (error) => {
      settle(null, cancelled ? 'Check command was cancelled.' : error.message)
    })
    child.on('close', (code) => {
      settle(
        timedOut || typeof code !== 'number' ? null : code,
        timedOut
          ? `Check command timed out after ${WORKSPACE_CHECK_TIMEOUT_SECONDS}s.`
          : cancelled
            ? 'Check command was cancelled.'
            : null
      )
    })
  })

  return {
    result,
    cancel: () => {
      cancelled = true
      killLocalPrecheckProcessTree(child)
    }
  }
}

function runSshChannelWorkspaceCheck(args: {
  command: string
  channel: ClientChannel
  startedAt: number
}): { result: Promise<WorkspaceCheckRunOutcome>; cancel: () => void } {
  const { command, channel, startedAt } = args
  const timeoutMs = WORKSPACE_CHECK_TIMEOUT_SECONDS * 1000
  let stdout: TailBuffer = { content: '', truncated: false }
  let stderr: TailBuffer = { content: '', truncated: false }
  let exitCode: number | null = null
  let timedOut = false
  let cancelled = false
  let settled = false
  let timeout: ReturnType<typeof setTimeout> | null = null

  const result = new Promise<WorkspaceCheckRunOutcome>((resolve) => {
    const settle = (code: number | null, error: string | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      resolve(
        createOutcome({ command, startedAt, stdout, stderr, exitCode: code, timedOut, error })
      )
    }

    timeout = setTimeout(() => {
      timedOut = true
      channel.close()
    }, timeoutMs)

    const fail = (error: Error): void => {
      settle(null, cancelled ? 'Check command was cancelled.' : error.message)
    }
    channel.on('error', fail)
    channel.stderr.on('error', fail)
    channel.on('data', (data: Buffer | string) => {
      stdout = appendTail(stdout, data.toString())
    })
    channel.stderr.on('data', (data: Buffer | string) => {
      stderr = appendTail(stderr, data.toString())
    })
    channel.on('exit', (code: number | null) => {
      exitCode = typeof code === 'number' ? code : null
    })
    channel.on('close', (code?: number | null) => {
      if (typeof code === 'number') {
        exitCode = code
      }
      settle(
        exitCode,
        timedOut
          ? `Check command timed out after ${WORKSPACE_CHECK_TIMEOUT_SECONDS}s.`
          : cancelled
            ? 'Check command was cancelled.'
            : null
      )
    })
  })

  return {
    result,
    cancel: () => {
      cancelled = true
      channel.close()
    }
  }
}

function startSshWorkspaceCheck(
  command: string,
  target: Extract<WorkspaceCheckExecutionTarget, { type: 'ssh' }>
): { result: Promise<WorkspaceCheckRunOutcome>; cancel: () => void } {
  const startedAt = Date.now()
  const manager = getSshConnectionManager()
  const connection = manager?.getConnection(target.connectionId)
  if (!connection || connection.getState().status !== 'connected') {
    return {
      result: Promise.resolve(
        createOutcome({
          command,
          startedAt,
          stdout: { content: '', truncated: false },
          stderr: { content: '', truncated: false },
          exitCode: null,
          timedOut: false,
          error: 'SSH target is not connected.'
        })
      ),
      cancel: () => {}
    }
  }

  let cancelFn: (() => void) | null = null
  let cancelledBeforeChannel = false
  const remoteCommand = `cd ${quotePosixShell(target.cwd)} && ${command}`
  const result = connection
    .exec(remoteCommand)
    .then((channel) => {
      if (cancelledBeforeChannel) {
        channel.close()
      }
      const started = runSshChannelWorkspaceCheck({ command, channel, startedAt })
      cancelFn = started.cancel
      return started.result
    })
    .catch((error: unknown) =>
      createOutcome({
        command,
        startedAt,
        stdout: { content: '', truncated: false },
        stderr: { content: '', truncated: false },
        exitCode: null,
        timedOut: false,
        error: error instanceof Error ? error.message : String(error)
      })
    )

  return {
    result,
    cancel: () => {
      if (cancelFn) {
        cancelFn()
      } else {
        cancelledBeforeChannel = true
      }
    }
  }
}

export function startWorkspaceCheckCommand(
  command: string,
  target: WorkspaceCheckExecutionTarget
): { result: Promise<WorkspaceCheckRunOutcome>; cancel: () => void } {
  if (target.type === 'ssh') {
    return startSshWorkspaceCheck(command, target)
  }
  return startLocalWorkspaceCheck(command, target)
}
