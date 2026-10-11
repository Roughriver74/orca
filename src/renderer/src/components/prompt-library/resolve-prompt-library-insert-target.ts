import type { AppState } from '@/store/types'

export type PromptLibraryInsertTarget = {
  ptyId: string
  tabId: string
}

/** The pty backing the active leaf of the active group's active tab in the active
 *  worktree — whether it renders as a raw terminal or a native-chat overlay, both are
 *  the same pty, so one resolver covers "focused agent terminal or native chat composer". */
export function resolvePromptLibraryInsertTarget(
  state: Pick<
    AppState,
    'activeWorktreeId' | 'activeGroupIdByWorktree' | 'groupsByWorktree' | 'terminalLayoutsByTabId'
  >
): PromptLibraryInsertTarget | null {
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    return null
  }
  const groupId = state.activeGroupIdByWorktree[worktreeId]
  if (!groupId) {
    return null
  }
  const group = state.groupsByWorktree[worktreeId]?.find((candidate) => candidate.id === groupId)
  const tabId = group?.activeTabId
  if (!tabId) {
    return null
  }
  const layout = state.terminalLayoutsByTabId[tabId]
  const activeLeafId = layout?.activeLeafId
  const ptyId = activeLeafId ? layout?.ptyIdsByLeafId?.[activeLeafId] : null
  return ptyId ? { ptyId, tabId } : null
}
