import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

export type OverlapRadarSlice = {
  /** Per-worktree changed-file paths (committed-since-base + uncommitted), kept fresh by
   *  background polling for sibling worktrees of the same repo. Absent entry = not yet
   *  polled (not "no changes"); overlap radar simply has nothing to compare for it yet. */
  overlapRadarChangedPathsByWorktree: Record<string, string[]>
  setOverlapRadarChangedPaths: (worktreeId: string, paths: string[]) => void
}

export const createOverlapRadarSlice: StateCreator<AppState, [], [], OverlapRadarSlice> = (
  set
) => ({
  overlapRadarChangedPathsByWorktree: {},
  setOverlapRadarChangedPaths: (worktreeId, paths) =>
    set((s) => ({
      overlapRadarChangedPathsByWorktree: {
        ...s.overlapRadarChangedPathsByWorktree,
        [worktreeId]: paths
      }
    }))
})
