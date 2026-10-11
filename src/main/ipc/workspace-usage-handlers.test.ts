import { describe, expect, it, vi } from 'vitest'

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }))

vi.mock('electron', () => ({ ipcMain: { handle } }))

import { registerWorkspaceUsageHandlers } from './workspace-usage-handlers'

function provider(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    provider: 'claude' as const,
    sessions: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 150,
    estimatedCostUsd: 1.5,
    ...overrides
  }
}

describe('workspace usage IPC handler', () => {
  it('merges per-provider worktree totals and sums known cost', async () => {
    const claudeUsage = {
      getAllWorktreeUsageToday: vi.fn().mockResolvedValue({
        'wt-1': provider({ provider: 'claude', totalTokens: 150, estimatedCostUsd: 1.5 })
      })
    }
    const codexUsage = {
      getAllWorktreeUsageToday: vi.fn().mockResolvedValue({
        'wt-1': provider({ provider: 'codex', totalTokens: 200, estimatedCostUsd: 2 }),
        'wt-2': provider({ provider: 'codex', totalTokens: 50, estimatedCostUsd: null })
      })
    }
    registerWorkspaceUsageHandlers({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mock implements the one method the registrar calls on each usage store.
      claudeUsage: claudeUsage as never,
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mock implements the one method the registrar calls on each usage store.
      codexUsage: codexUsage as never
    })

    const [, getAllToday] = handle.mock.calls.find(
      ([channel]) => channel === 'workspaceUsage:getAllToday'
    )!
    const result = await getAllToday()

    expect(result['wt-1']).toEqual({
      worktreeId: 'wt-1',
      providers: [
        provider({ provider: 'claude', totalTokens: 150, estimatedCostUsd: 1.5 }),
        provider({ provider: 'codex', totalTokens: 200, estimatedCostUsd: 2 })
      ],
      totalTokens: 350,
      estimatedCostUsd: 3.5,
      hasPartialCost: false
    })
    expect(result['wt-2']).toEqual({
      worktreeId: 'wt-2',
      providers: [provider({ provider: 'codex', totalTokens: 50, estimatedCostUsd: null })],
      totalTokens: 50,
      estimatedCostUsd: null,
      hasPartialCost: true
    })
  })
})
