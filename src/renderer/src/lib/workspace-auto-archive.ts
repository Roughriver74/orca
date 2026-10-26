import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { getWorktreeIdsWithLiveAgent } from '@/lib/worktree-activity-state'
import { getDeleteStateForWorktreeHost } from '@/components/sidebar/worktree-delete-state-host-match'
import {
  isArchivableWorktree,
  runAutoArchiveWorktrees
} from '@/components/sidebar/archive-worktree-flow'
import { getPersistedWorkspaceCleanupActivityAt } from '../../../shared/workspace-cleanup'
import { resolveWorkspaceAutoArchiveDays } from '../../../shared/workspace-auto-archive'

const DAY_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 30 * 60 * 1000
// Why: session restore re-selects and re-stamps workspaces right after startup; let it settle first.
const STARTUP_GRACE_MS = 60 * 1000

export type AutoArchiveState = Pick<
  AppState,
  | 'worktreesByRepo'
  | 'activeWorktreeId'
  | 'lastVisitedAtByWorktreeId'
  | 'agentStatusByPaneKey'
  | 'tabsByWorktree'
  | 'deleteStateByWorktreeId'
>

/**
 * Workspace ids idle for at least `idleMs`. Idle = no persisted activity stamp
 * (terminal start/exit, agent turns, creation) and no visit inside the window.
 * Never picks the open workspace, a pinned or primary checkout, one with a working
 * agent, or one being deleted. A stampless row is unknown, not idle, so it stays.
 */
export function selectIdleWorktreeIdsForAutoArchive(
  state: AutoArchiveState,
  now: number,
  idleMs: number
): string[] {
  const liveAgentWorktreeIds = getWorktreeIdsWithLiveAgent(
    state.agentStatusByPaneKey,
    state.tabsByWorktree,
    now
  )
  const idle = new Set<string>()
  // Why: host twins share one id and one archive write, so any busy copy keeps the id.
  const kept = new Set<string>()
  for (const worktree of getIndexedAllWorktrees(state.worktreesByRepo)) {
    const activityAt = Math.max(
      getPersistedWorkspaceCleanupActivityAt(worktree),
      getWorktreeVisitTimestamp(state.lastVisitedAtByWorktreeId, worktree) ?? 0
    )
    const eligible =
      isArchivableWorktree(worktree) &&
      !worktree.isPinned &&
      !worktree.isMainWorktree &&
      !worktree.removing &&
      worktree.id !== state.activeWorktreeId &&
      !liveAgentWorktreeIds.has(worktree.id) &&
      !getDeleteStateForWorktreeHost(worktree, state.deleteStateByWorktreeId) &&
      activityAt > 0 &&
      now - activityAt >= idleMs
    if (eligible) {
      idle.add(worktree.id)
    } else {
      kept.add(worktree.id)
    }
  }
  return [...idle].filter((id) => !kept.has(id))
}

/**
 * Archives idle workspaces on a timer (setting `autoArchiveInactiveWorkspacesDays`).
 * Runs in the renderer because archive = sleep + flag, and the sleep tears down
 * renderer-owned panes.
 */
export function installWorkspaceAutoArchive(store = useAppStore): () => void {
  let disposed = false
  let sweeping = false
  let startupTimer: number | undefined

  const sweep = async (): Promise<void> => {
    const state = store.getState()
    if (disposed || sweeping || !state.startupWorktreeRefreshCompleted || !state.settings) {
      return
    }
    const idleDays = resolveWorkspaceAutoArchiveDays(state.settings)
    if (idleDays === 0) {
      return
    }
    const ids = selectIdleWorktreeIdsForAutoArchive(state, Date.now(), idleDays * DAY_MS)
    if (ids.length === 0) {
      return
    }
    sweeping = true
    try {
      await runAutoArchiveWorktrees(ids, idleDays)
    } catch (error) {
      console.error('[auto-archive] sweep failed', error)
    } finally {
      sweeping = false
    }
  }

  const scheduleStartupSweep = (): void => {
    startupTimer ??= window.setTimeout(() => void sweep(), STARTUP_GRACE_MS)
  }
  if (store.getState().startupWorktreeRefreshCompleted) {
    scheduleStartupSweep()
  }
  const unsubscribe = store.subscribe((state, prev) => {
    if (state.startupWorktreeRefreshCompleted && !prev.startupWorktreeRefreshCompleted) {
      scheduleStartupSweep()
    }
    // Why: a lowered threshold should apply now, not on the next half-hour tick.
    if (
      startupTimer !== undefined &&
      state.settings?.autoArchiveInactiveWorkspacesDays !==
        prev.settings?.autoArchiveInactiveWorkspacesDays
    ) {
      void sweep()
    }
  })
  const interval = window.setInterval(() => void sweep(), SWEEP_INTERVAL_MS)

  return () => {
    disposed = true
    unsubscribe()
    window.clearInterval(interval)
    window.clearTimeout(startupTimer)
  }
}
