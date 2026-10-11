// ─── Per-workspace "Check command" engine ────────────────────────────────────
// Drives one stepWorkspaceCheckRunner reducer per worktreeId off agent-pane busy/idle edges
// reported by the agent-hook server's status snapshot, debounces a quiet window before running,
// and discards a superseded run's eventual completion via a per-worktree generation token.
import type { Store } from '../persistence'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-types'
import type { AgentHookStatusChangeEntry } from '../agent-hooks/server/server-types'
import type { NotificationDeliveryService } from '../notifications/notification-delivery-service'
import {
  WORKSPACE_CHECK_DEBOUNCE_MS,
  type WorkspaceCheckState
} from '../../shared/workspace-check-types'
import {
  stepWorkspaceCheckRunner,
  type WorkspaceCheckRunnerEffect,
  type WorkspaceCheckRunnerState
} from './workspace-check-state-machine'
import { startWorkspaceCheckCommand } from './workspace-check-command-runner'
import {
  resolveWorkspaceCheckExecutionTarget,
  resolveWorkspaceCheckTarget
} from './workspace-check-target'
import {
  buildFailedResolutionWorkspaceCheckState,
  buildFinishedWorkspaceCheckState,
  buildRunningWorkspaceCheckState
} from './workspace-check-run-state'

type WorkspaceCheckServiceDependencies = {
  getStore: () => Pick<Store, 'getRepo'> | null
  getRuntime: () => { getTerminalWorktreeIdForPaneKey(paneKey: string): string | null } | null
  getNotificationDeliveryService: () => NotificationDeliveryService | null
  getStatusSnapshot: () => AgentStatusIpcPayload[]
  emitClientEvent: (worktreeId: string, state: WorkspaceCheckState | null) => void
  now?: () => number
}

type WorkspaceCheckController = {
  runnerState: WorkspaceCheckRunnerState
  debounceTimer: ReturnType<typeof setTimeout> | null
  runToken: number
  activeRun: { cancel: () => void } | null
}

type RunTokenWaiter = { token: number; resolve: (state: WorkspaceCheckState) => void }

function createController(): WorkspaceCheckController {
  return { runnerState: { phase: 'idle' }, debounceTimer: null, runToken: 0, activeRun: null }
}

export class WorkspaceCheckService {
  private readonly deps: WorkspaceCheckServiceDependencies
  private readonly now: () => number
  private readonly controllers = new Map<string, WorkspaceCheckController>()
  private readonly statesByWorktreeId = new Map<string, WorkspaceCheckState>()
  private readonly busyByWorktreeId = new Map<string, boolean>()
  private readonly seenWorktreeIds = new Set<string>()
  // Lets a manual runNow() resolve on exactly the attempt it triggered, rather than polling.
  private readonly runTokenResolvers = new Map<string, RunTokenWaiter[]>()

  constructor(deps: WorkspaceCheckServiceDependencies) {
    this.deps = deps
    this.now = deps.now ?? Date.now
  }

  getState(worktreeId: string): WorkspaceCheckState | null {
    return this.statesByWorktreeId.get(worktreeId) ?? null
  }

  handleStatusChanges(_statuses: AgentHookStatusChangeEntry[]): void {
    const store = this.deps.getStore()
    if (!store) {
      return
    }
    const runtime = this.deps.getRuntime()
    const currentBusyByWorktreeId = new Map<string, boolean>()
    for (const row of this.deps.getStatusSnapshot()) {
      const worktreeId = row.worktreeId ?? runtime?.getTerminalWorktreeIdForPaneKey(row.paneKey)
      if (!worktreeId) {
        continue
      }
      this.seenWorktreeIds.add(worktreeId)
      if (row.state === 'working' || !currentBusyByWorktreeId.has(worktreeId)) {
        currentBusyByWorktreeId.set(worktreeId, row.state === 'working')
      }
    }
    // A worktree whose last pane just disappeared is still evaluated — it must transition out
    // of `busy` even though this snapshot no longer mentions it at all.
    for (const worktreeId of this.seenWorktreeIds) {
      if (!currentBusyByWorktreeId.has(worktreeId)) {
        currentBusyByWorktreeId.set(worktreeId, false)
      }
    }

    for (const [worktreeId, busy] of currentBusyByWorktreeId) {
      const target = resolveWorkspaceCheckTarget(store, worktreeId)
      if (!target.ok || !target.repo.checkCommand) {
        continue
      }
      const wasBusy = this.busyByWorktreeId.get(worktreeId) ?? false
      this.busyByWorktreeId.set(worktreeId, busy)
      if (busy === wasBusy) {
        continue
      }
      this.dispatch(worktreeId, { type: busy ? 'agent-working' : 'agent-finished' })
    }
  }

  async runNow(worktreeId: string): Promise<WorkspaceCheckState> {
    const store = this.deps.getStore()
    const target = store ? resolveWorkspaceCheckTarget(store, worktreeId) : null
    if (!target || !target.ok || !target.repo.checkCommand) {
      throw new Error('No check command is configured for this repo.')
    }
    const { promise, resolve } = Promise.withResolvers<WorkspaceCheckState>()
    const runToken = this.dispatch(worktreeId, { type: 'manual-run-requested' })
    const waiters = this.runTokenResolvers.get(worktreeId) ?? []
    waiters.push({ token: runToken, resolve })
    this.runTokenResolvers.set(worktreeId, waiters)
    return promise
  }

  dispose(): void {
    for (const [worktreeId, controller] of this.controllers) {
      clearTimeout(controller.debounceTimer ?? undefined)
      controller.activeRun?.cancel()
      controller.runToken += 1
      this.deps.emitClientEvent(worktreeId, null)
    }
    this.controllers.clear()
    this.statesByWorktreeId.clear()
    this.busyByWorktreeId.clear()
    this.seenWorktreeIds.clear()
    this.runTokenResolvers.clear()
  }

  /** Feeds a reducer event for a worktree and applies its effects; returns the run token of the
   *  started/restarted run (if any). */
  private dispatch(
    worktreeId: string,
    event: Parameters<typeof stepWorkspaceCheckRunner>[1]
  ): number {
    const controller = this.controllers.get(worktreeId) ?? createController()
    this.controllers.set(worktreeId, controller)
    const { state, effects } = stepWorkspaceCheckRunner(controller.runnerState, event)
    controller.runnerState = state
    return this.applyEffects(worktreeId, controller, effects)
  }

  private applyEffects(
    worktreeId: string,
    controller: WorkspaceCheckController,
    effects: WorkspaceCheckRunnerEffect[]
  ): number {
    let startedRunToken = controller.runToken
    for (const effect of effects) {
      switch (effect) {
        case 'start-debounce':
          controller.debounceTimer = setTimeout(() => {
            controller.debounceTimer = null
            this.dispatch(worktreeId, { type: 'debounce-elapsed' })
          }, WORKSPACE_CHECK_DEBOUNCE_MS)
          break
        case 'cancel-debounce':
          clearTimeout(controller.debounceTimer ?? undefined)
          controller.debounceTimer = null
          break
        case 'cancel-run':
          controller.runToken += 1
          controller.activeRun?.cancel()
          controller.activeRun = null
          break
        case 'start-run':
          startedRunToken = this.startRun(worktreeId, controller)
          break
      }
    }
    return startedRunToken
  }

  private startRun(worktreeId: string, controller: WorkspaceCheckController): number {
    controller.runToken += 1
    const runToken = controller.runToken
    const store = this.deps.getStore()
    const target = store ? resolveWorkspaceCheckTarget(store, worktreeId) : null
    const startedAt = this.now()

    if (!target || !target.ok || !target.repo.checkCommand) {
      this.finishWithResolutionFailure(worktreeId, controller, runToken, {
        command: '',
        error:
          target && !target.ok ? target.error : 'No check command is configured for this repo.',
        repoLabel: undefined,
        startedAt
      })
      return runToken
    }
    const executionTarget = resolveWorkspaceCheckExecutionTarget(target.repo, target.cwd)
    if (!executionTarget.ok) {
      this.finishWithResolutionFailure(worktreeId, controller, runToken, {
        command: target.repo.checkCommand,
        error: executionTarget.error,
        repoLabel: target.repo.displayName,
        startedAt
      })
      return runToken
    }

    const command = target.repo.checkCommand
    const repoLabel = target.repo.displayName
    this.publish(worktreeId, buildRunningWorkspaceCheckState(worktreeId, command, startedAt))

    const { result, cancel } = startWorkspaceCheckCommand(command, executionTarget.target)
    controller.activeRun = { cancel }
    void result.then((outcome) => {
      if (controller.runToken !== runToken) {
        return // Superseded by a cancel/newer run: discard silently.
      }
      controller.activeRun = null
      const finished = buildFinishedWorkspaceCheckState(worktreeId, outcome)
      this.publish(worktreeId, finished)
      if (finished.status === 'failed') {
        this.notifyFailure(worktreeId, repoLabel)
      }
      this.resolveRunToken(worktreeId, runToken, finished)
      this.dispatch(worktreeId, { type: 'run-finished' })
    })
    return runToken
  }

  /** Target/execution-host resolution failed before any process could start: synthesize a
   *  `failed` state immediately and feed the reducer as if a run had completed. */
  private finishWithResolutionFailure(
    worktreeId: string,
    controller: WorkspaceCheckController,
    runToken: number,
    args: { command: string; error: string; repoLabel: string | undefined; startedAt: number }
  ): void {
    const failed = buildFailedResolutionWorkspaceCheckState({
      worktreeId,
      command: args.command,
      error: args.error,
      startedAt: args.startedAt,
      finishedAt: this.now()
    })
    this.publish(worktreeId, failed)
    this.notifyFailure(worktreeId, args.repoLabel)
    this.resolveRunToken(worktreeId, runToken, failed)
    if (controller.runToken === runToken) {
      this.dispatch(worktreeId, { type: 'run-finished' })
    }
  }

  private publish(worktreeId: string, state: WorkspaceCheckState): void {
    this.statesByWorktreeId.set(worktreeId, state)
    this.deps.emitClientEvent(worktreeId, state)
  }

  private notifyFailure(worktreeId: string, repoLabel: string | undefined): void {
    this.deps.getNotificationDeliveryService()?.dispatch({
      source: 'check-failed',
      worktreeId,
      repoLabel,
      attentionKey: `workspace-check:${worktreeId}`
    })
  }

  private resolveRunToken(worktreeId: string, runToken: number, state: WorkspaceCheckState): void {
    const waiters = this.runTokenResolvers.get(worktreeId)
    if (!waiters) {
      return
    }
    const remaining = waiters.filter((waiter) => {
      if (waiter.token !== runToken) {
        return true
      }
      waiter.resolve(state)
      return false
    })
    if (remaining.length > 0) {
      this.runTokenResolvers.set(worktreeId, remaining)
    } else {
      this.runTokenResolvers.delete(worktreeId)
    }
  }
}
