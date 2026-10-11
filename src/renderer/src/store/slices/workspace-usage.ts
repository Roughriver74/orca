import type { StateCreator } from 'zustand'
import type { WorkspaceUsageToday } from '../../../../shared/workspace-usage-types'
import type { AppState } from '../types'

export type WorkspaceUsageSlice = {
  workspaceUsageTodayByWorktreeId: Record<string, WorkspaceUsageToday>
  fetchWorkspaceUsageToday: () => Promise<void>
}

export const createWorkspaceUsageSlice: StateCreator<AppState, [], [], WorkspaceUsageSlice> = (
  set
) => ({
  workspaceUsageTodayByWorktreeId: {},

  fetchWorkspaceUsageToday: async () => {
    try {
      const byWorktreeId = await window.api.workspaceUsage.getAllToday()
      set({ workspaceUsageTodayByWorktreeId: byWorktreeId })
    } catch {
      // Why: a failed fetch (usage scanning disabled, IPC error) should just leave the
      // sidebar showing no usage figures rather than surface an error to the user.
    }
  }
})
