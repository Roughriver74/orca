import { useAppStore } from './index'
import type { AppState } from './types'
import { getWorktreeMapFromState } from './selectors'
import {
  computeOverlapRadarMatches,
  type OverlapRadarPeerOverlap,
  type OverlapRadarWorktreeChanges
} from '../../../shared/overlap-radar/overlap-radar-intersection'

const EMPTY_OVERLAP_PEERS: OverlapRadarPeerOverlap[] = []

type OverlapRadarInputState = Pick<
  AppState,
  'worktreesByRepo' | 'overlapRadarChangedPathsByWorktree'
>

// Why: recomputing the full cross-worktree intersection on every render would scan every
// polled worktree's path set each time a sidebar card subscribes. Cache by the changed-paths
// map's identity (bumped only when a poll result lands) and invalidate if the worktree
// catalog itself changed underneath it (rename/removal can shift repoId/displayName).
const overlapRadarMatchesCache = new WeakMap<
  AppState['overlapRadarChangedPathsByWorktree'],
  {
    worktreesByRepo: AppState['worktreesByRepo']
    matches: Record<string, OverlapRadarPeerOverlap[]>
  }
>()

export function getOverlapRadarMatchesFromState(
  state: OverlapRadarInputState
): Record<string, OverlapRadarPeerOverlap[]> {
  // Why: hand-rolled store mocks in component tests often omit this slice (or even
  // `worktreesByRepo` itself) entirely.
  const changedPathsByWorktree = state.overlapRadarChangedPathsByWorktree ?? {}
  const worktreesByRepo = state.worktreesByRepo ?? {}
  const cached = overlapRadarMatchesCache.get(changedPathsByWorktree)
  if (cached && cached.worktreesByRepo === worktreesByRepo) {
    return cached.matches
  }
  const worktreeById = getWorktreeMapFromState({ worktreesByRepo })
  const inputs: OverlapRadarWorktreeChanges[] = []
  for (const [worktreeId, changedPaths] of Object.entries(changedPathsByWorktree)) {
    const worktree = worktreeById.get(worktreeId)
    if (!worktree) {
      continue
    }
    inputs.push({
      worktreeId,
      repoId: worktree.repoId,
      displayName: worktree.displayName,
      changedPaths
    })
  }
  const matches = computeOverlapRadarMatches(inputs)
  overlapRadarMatchesCache.set(changedPathsByWorktree, {
    worktreesByRepo,
    matches
  })
  return matches
}

/** Other worktrees overlapping `worktreeId`'s changed files, or an empty, stable array. */
export function useOverlapRadarPeers(worktreeId: string | null): OverlapRadarPeerOverlap[] {
  return useAppStore((s) =>
    worktreeId
      ? (getOverlapRadarMatchesFromState(s)[worktreeId] ?? EMPTY_OVERLAP_PEERS)
      : EMPTY_OVERLAP_PEERS
  )
}
