import { ipcMain } from 'electron'
import type { WorkspaceUsageToday } from '../../shared/workspace-usage-types'
import type { ClaudeUsageStore } from '../claude-usage/store'
import type { CodexUsageStore } from '../codex-usage/store'

type WorkspaceUsageStores = {
  claudeUsage: ClaudeUsageStore
  codexUsage: CodexUsageStore
}

/** Combines Claude + Codex per-worktree totals. Other providers (OpenCode, Muse) do not yet
 *  attribute usage per-worktree with this entry point; add them here once they do. */
export function registerWorkspaceUsageHandlers(stores: WorkspaceUsageStores): void {
  ipcMain.handle(
    'workspaceUsage:getAllToday',
    async (): Promise<Record<string, WorkspaceUsageToday>> => {
      const [claudeByWorktree, codexByWorktree] = await Promise.all([
        stores.claudeUsage.getAllWorktreeUsageToday(),
        stores.codexUsage.getAllWorktreeUsageToday()
      ])
      const worktreeIds = new Set([
        ...Object.keys(claudeByWorktree),
        ...Object.keys(codexByWorktree)
      ])
      const result: Record<string, WorkspaceUsageToday> = {}
      for (const worktreeId of worktreeIds) {
        const providers = [claudeByWorktree[worktreeId], codexByWorktree[worktreeId]].filter(
          (provider) => provider !== undefined
        )
        const totalTokens = providers.reduce((sum, provider) => sum + provider.totalTokens, 0)
        const knownCost = providers.reduce(
          (sum, provider) => sum + (provider.estimatedCostUsd ?? 0),
          0
        )
        const hasKnownCost = providers.some((provider) => provider.estimatedCostUsd !== null)
        result[worktreeId] = {
          worktreeId,
          providers,
          totalTokens,
          estimatedCostUsd: hasKnownCost ? knownCost : null,
          hasPartialCost: providers.some((provider) => provider.estimatedCostUsd === null)
        }
      }
      return result
    }
  )
}
