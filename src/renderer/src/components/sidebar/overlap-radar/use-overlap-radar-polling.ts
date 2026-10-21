import { useEffect, useMemo } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Worktree } from '../../../../../shared/worktree/types'
import { getConnectionId } from '@/lib/connection-context'
import { isWindowVisible, installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { resolveSourceControlBaseRef } from '../../right-sidebar/source-control/sync/base-ref-resolution'
import { useAppStore } from '@/store'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import { requireGitOwnerTarget } from '../../right-sidebar/worktree-git-owner-target'
import {
  createCoalescedPollRunner,
  type SlowTaskBackoffOptions
} from '../../right-sidebar/coalesced-poll-runner'
import { fetchOverlapRadarChangedPaths } from './overlap-radar-changed-paths-fetch'

// Why: heavier than the fs-only conflict probe (3s) since it runs a real git status plus
// a ranged diff per candidate worktree, but these background siblings have no other poller
// keeping them warm, so it stays well under the active worktree's own 30s branch-compare cadence.
const OVERLAP_RADAR_POLL_INTERVAL_MS = 20_000

type OverlapRadarCandidate = { worktree: Worktree; baseRef: string | null }

/**
 * Polls every worktree in a multi-worktree git repo for its overlap-radar changed-file
 * set, so the sidebar can warn when siblings touch the same files. Repos with only one
 * worktree are skipped entirely — they can never overlap with anything.
 */
export function useOverlapRadarPolling(args: {
  enabled: boolean
  allWorktrees: readonly Worktree[]
  repoMap: Map<string, Pick<Repo, 'kind' | 'worktreeBaseRef'>>
  setOverlapRadarChangedPaths: (worktreeId: string, paths: string[]) => void
  isConnectionReady: (connectionId: string | null | undefined) => boolean
  slowTaskBackoff: SlowTaskBackoffOptions
}): void {
  const {
    enabled,
    allWorktrees,
    repoMap,
    setOverlapRadarChangedPaths,
    isConnectionReady,
    slowTaskBackoff
  } = args

  const candidates = useMemo(() => {
    const countByRepo = new Map<string, number>()
    for (const worktree of allWorktrees) {
      countByRepo.set(worktree.repoId, (countByRepo.get(worktree.repoId) ?? 0) + 1)
    }
    const result: OverlapRadarCandidate[] = []
    for (const worktree of allWorktrees) {
      if (worktree.removing || worktree.isArchived) {
        continue
      }
      if ((countByRepo.get(worktree.repoId) ?? 0) < 2) {
        continue
      }
      const repo = repoMap.get(worktree.repoId)
      if (!repo || !isGitRepoKind(repo)) {
        continue
      }
      const baseRef = resolveSourceControlBaseRef({
        worktreeBaseRef: worktree.baseRef,
        reviewBaseRefName: null,
        repoBaseRef: repo.worktreeBaseRef,
        defaultBaseRef: null
      })
      result.push({ worktree, baseRef })
    }
    return result
  }, [allWorktrees, repoMap])

  useEffect(() => {
    if (!enabled || candidates.length === 0) {
      return
    }
    // Why: dispose() cannot interrupt an in-flight batch; without this guard a fetch
    // resolving after cleanup would overwrite a newer snapshot with a stale one.
    let active = true

    const pollAll = async (): Promise<void> => {
      if (!isWindowVisible()) {
        return
      }
      await Promise.all(
        candidates.map(async ({ worktree, baseRef }) => {
          const connectionId = getConnectionId(worktree.id) ?? undefined
          if (!isConnectionReady(connectionId)) {
            return
          }
          try {
            const paths = await fetchOverlapRadarChangedPaths(
              {
                target: requireGitOwnerTarget(
                  runtimeTargetForWorkspaceOwner(useAppStore.getState(), {
                    workspaceId: worktree.id
                  })
                ),
                worktreeId: worktree.id,
                worktreePath: worktree.path,
                connectionId
              },
              baseRef
            )
            if (active) {
              setOverlapRadarChangedPaths(worktree.id, paths)
            }
          } catch {
            // Why: a disconnected host or a transient git failure must not blank the last
            // known overlap snapshot — leave it in place until the next successful poll.
          }
        })
      )
    }

    const pollRunner = createCoalescedPollRunner(pollAll, { slowTaskBackoff })
    const stopVisiblePoll = installWindowVisibilityInterval({
      run: () => pollRunner.run(),
      runOnVisible: () => pollRunner.run({ changeSignal: true }),
      intervalMs: OVERLAP_RADAR_POLL_INTERVAL_MS
    })
    return () => {
      active = false
      pollRunner.dispose()
      stopVisiblePoll()
    }
  }, [enabled, candidates, setOverlapRadarChangedPaths, isConnectionReady, slowTaskBackoff])
}
