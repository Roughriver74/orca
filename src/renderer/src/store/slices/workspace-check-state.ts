import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { WorkspaceCheckState } from '../../../../shared/workspace-check-types'

export type WorkspaceCheckStateSlice = {
  workspaceCheckStateByWorktreeId: Record<string, WorkspaceCheckState | null>
  setWorkspaceCheckState: (worktreeId: string, state: WorkspaceCheckState | null) => void
}

export const createWorkspaceCheckStateSlice: StateCreator<
  AppState,
  [],
  [],
  WorkspaceCheckStateSlice
> = (set) => ({
  workspaceCheckStateByWorktreeId: {},
  setWorkspaceCheckState: (worktreeId, state) =>
    set((current) => ({
      workspaceCheckStateByWorktreeId: {
        ...current.workspaceCheckStateByWorktreeId,
        [worktreeId]: state
      }
    }))
})
