import { describe, expect, it } from 'vitest'
import type { CodexUsageDailyAggregate, CodexUsagePersistedState, CodexUsageSession } from './types'
import { buildAllWorktreeTodayUsage } from './codex-usage-rollup-projections'
import { getTodayLocalUsageDay } from '../usage/usage-calendar-range'

function dailyRow(
  day: string,
  worktreeId: string | null,
  model = 'gpt-5'
): CodexUsageDailyAggregate {
  return {
    day,
    model,
    projectKey: worktreeId ? `worktree:${worktreeId}` : 'unscoped',
    projectLabel: 'project',
    repoId: null,
    worktreeId,
    eventCount: 1,
    inputTokens: 1_000_000,
    cachedInputTokens: 0,
    outputTokens: 1_000_000,
    reasoningOutputTokens: 0,
    totalTokens: 2_000_000,
    hasInferredPricing: false,
    longContextInputTokens: 0,
    longContextCachedInputTokens: 0,
    longContextOutputTokens: 0
  }
}

function session(
  sessionId: string,
  lastTimestamp: string,
  worktreeId: string | null
): CodexUsageSession {
  return {
    sessionId,
    firstTimestamp: lastTimestamp,
    lastTimestamp,
    primaryModel: 'gpt-5',
    hasMixedModels: false,
    primaryProjectLabel: 'project',
    hasMixedLocations: false,
    primaryWorktreeId: worktreeId,
    primaryRepoId: null,
    eventCount: 1,
    totalInputTokens: 0,
    totalCachedInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningOutputTokens: 0,
    totalTokens: 0,
    hasInferredPricing: false,
    locationBreakdown:
      worktreeId === null
        ? []
        : [
            {
              locationKey: `worktree:${worktreeId}`,
              projectLabel: 'project',
              repoId: null,
              worktreeId,
              eventCount: 1,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
              totalTokens: 0,
              hasInferredPricing: false,
              longContextInputTokens: 0,
              longContextCachedInputTokens: 0,
              longContextOutputTokens: 0
            }
          ],
    modelBreakdown: [],
    locationModelBreakdown: [],
    longContextInputTokens: 0,
    longContextCachedInputTokens: 0,
    longContextOutputTokens: 0
  }
}

function stateWithDaily(dailyAggregates: CodexUsageDailyAggregate[]): CodexUsagePersistedState {
  return {
    schemaVersion: 1,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates,
    scanState: {
      enabled: true,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    }
  }
}

describe('buildAllWorktreeTodayUsage', () => {
  const today = getTodayLocalUsageDay()

  it("groups today's tokens and distinct sessions per worktree, pricing per model", () => {
    const state = stateWithDaily([
      dailyRow(today, 'wt-1'),
      dailyRow('2020-01-01', 'wt-1'),
      dailyRow(today, 'wt-2')
    ])
    state.sessions = [
      session('session-1', `${today}T10:00:00.000Z`, 'wt-1'),
      session('session-2', `${today}T11:00:00.000Z`, 'wt-1')
    ]

    const byWorktree = buildAllWorktreeTodayUsage(state)

    expect(byWorktree.get('wt-1')).toEqual({
      provider: 'codex',
      sessions: 2,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2_000_000,
      estimatedCostUsd: 11.25
    })
    expect(byWorktree.get('wt-2')?.sessions).toBe(0)
    expect(byWorktree.get('wt-2')?.estimatedCostUsd).toBeCloseTo(11.25)
  })

  it('omits worktrees with no usage today', () => {
    const state = stateWithDaily([dailyRow('2020-01-01', 'wt-1')])

    expect(buildAllWorktreeTodayUsage(state).size).toBe(0)
  })
})
