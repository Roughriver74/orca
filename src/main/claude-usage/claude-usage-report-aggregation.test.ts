import { describe, expect, it } from 'vitest'
import type {
  ClaudeUsageDailyAggregate,
  ClaudeUsagePersistedState,
  ClaudeUsageSession
} from './types'
import { buildAllWorktreeTodayUsage, buildBreakdown, buildSummary } from './claude-usage-report-aggregation'
import { getTodayLocalUsageDay } from '../usage/usage-calendar-range'

function dailyRow(day: string, model: string): ClaudeUsageDailyAggregate {
  return {
    day,
    model,
    projectKey: 'project',
    projectLabel: 'project',
    repoId: null,
    worktreeId: 'worktree-1',
    turnCount: 1,
    zeroCacheReadTurnCount: 0,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0
  }
}

function stateWithDaily(dailyAggregates: ClaudeUsageDailyAggregate[]): ClaudeUsagePersistedState {
  return {
    schemaVersion: 6,
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

function session(
  sessionId: string,
  lastTimestamp: string,
  worktreeId: string | null
): ClaudeUsageSession {
  return {
    sessionId,
    firstTimestamp: lastTimestamp,
    lastTimestamp,
    model: 'claude-sonnet-5',
    lastCwd: null,
    lastGitBranch: null,
    primaryWorktreeId: worktreeId,
    primaryRepoId: null,
    turnCount: 1,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    totalCacheWrite1hTokens: 0,
    locationBreakdown:
      worktreeId === null
        ? []
        : [
            {
              locationKey: `worktree:${worktreeId}`,
              projectLabel: 'project',
              repoId: null,
              worktreeId,
              turnCount: 1,
              inputTokens: 0,
              outputTokens: 0,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              cacheWrite1hTokens: 0
            }
          ]
  }
}

describe('buildAllWorktreeTodayUsage', () => {
  const today = getTodayLocalUsageDay()

  it("groups today's tokens and distinct sessions per worktree, pricing per model", () => {
    const state = stateWithDaily([
      { ...dailyRow(today, 'claude-sonnet-5'), worktreeId: 'wt-1' },
      { ...dailyRow('2020-01-01', 'claude-sonnet-5'), worktreeId: 'wt-1' },
      { ...dailyRow(today, 'claude-sonnet-5'), worktreeId: 'wt-2' }
    ])
    state.sessions = [
      session('session-1', `${today}T10:00:00.000Z`, 'wt-1'),
      session('session-2', `${today}T11:00:00.000Z`, 'wt-1')
    ]

    const byWorktree = buildAllWorktreeTodayUsage(state)

    expect(byWorktree.get('wt-1')).toEqual({
      provider: 'claude',
      sessions: 2,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 2_000_000,
      estimatedCostUsd: 12
    })
    expect(byWorktree.get('wt-2')?.sessions).toBe(0)
    expect(byWorktree.get('wt-2')?.estimatedCostUsd).toBeCloseTo(12)
  })

  it('omits worktrees with no usage today', () => {
    const state = stateWithDaily([
      { ...dailyRow('2020-01-01', 'claude-sonnet-5'), worktreeId: 'wt-1' }
    ])

    expect(buildAllWorktreeTodayUsage(state).size).toBe(0)
  })
})

describe('buildSummary Claude Sonnet 5 pricing over time', () => {
  // Why: the "All" range re-prices historical days on every render, so a day inside the
  // announced 2026-08-31 introductory window has to price the same as a later day —
  // the scheduled $3/$15 increase was cancelled and never took effect.
  it('prices an introductory-window day and a post-window day at the same $2/$10 rate', () => {
    const inWindow = buildSummary(
      stateWithDaily([dailyRow('2026-08-15', 'claude-sonnet-5')]),
      'all',
      'all'
    )
    const afterWindow = buildSummary(
      stateWithDaily([dailyRow('2026-09-15', 'claude-sonnet-5')]),
      'all',
      'all'
    )

    expect(inWindow.estimatedCostUsd).toBeCloseTo(12)
    expect(afterWindow.estimatedCostUsd).toBeCloseTo(12)
  })

  it('sums both days in the All range without re-pricing history upward', () => {
    const summary = buildSummary(
      stateWithDaily([
        dailyRow('2026-08-15', 'claude-sonnet-5'),
        dailyRow('2026-09-15', 'claude-sonnet-5')
      ]),
      'all',
      'all'
    )

    expect(summary.estimatedCostUsd).toBeCloseTo(24)
  })
})

describe('buildSummary unpriced models', () => {
  it('keeps the priced total and flags the rows it had to leave out', () => {
    const summary = buildSummary(
      stateWithDaily([
        dailyRow('2026-10-15', 'claude-sonnet-5-5'),
        dailyRow('2026-10-15', 'claude-opus-9')
      ]),
      'all',
      'all'
    )

    expect(summary.estimatedCostUsd).toBeCloseTo(12)
    expect(summary.hasUnpricedModels).toBe(true)
  })

  it('does not flag rows that carry no model name', () => {
    const row = { ...dailyRow('2026-10-15', 'claude-sonnet-5-5'), model: null }
    const summary = buildSummary(stateWithDaily([row]), 'all', 'all')

    expect(summary.estimatedCostUsd).toBeNull()
    expect(summary.hasUnpricedModels).toBe(false)
  })
})

describe('buildSummary Haiku 5.5 long-context requests', () => {
  it('bills only the requests recorded over 100K at the long-context rates', () => {
    const row = {
      ...dailyRow('2026-10-15', 'claude-haiku-5-5'),
      longContext: {
        inputTokens: 500_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheWrite1hTokens: 0
      }
    }
    const state = stateWithDaily([row])

    // 500K input at $0.10 + 500K at $0.50 + 1M output at $0.50.
    expect(buildSummary(state, 'all', 'all').estimatedCostUsd).toBeCloseTo(0.8)
    expect(buildSummary(state, 'all', 'all').hasUnpricedModels).toBe(false)
    expect(buildBreakdown(state, 'all', 'all', 'model')[0]?.estimatedCostUsd).toBeCloseTo(0.8)
  })
})
