import { describe, expect, it } from 'vitest'
import { getTodayLocalUsageDay } from './usage-calendar-range'
import {
  groupTodayDailyByWorktree,
  groupTodaySessionCountsByWorktree
} from './workspace-usage-today'

type DailyRow = { day: string; worktreeId: string | null; tokens: number }

describe('groupTodayDailyByWorktree', () => {
  const today = getTodayLocalUsageDay()

  it("groups only today's rows by worktree, dropping other days and unattributed rows", () => {
    const rows: DailyRow[] = [
      { day: today, worktreeId: 'wt-1', tokens: 100 },
      { day: today, worktreeId: 'wt-1', tokens: 50 },
      { day: today, worktreeId: 'wt-2', tokens: 10 },
      { day: '2020-01-01', worktreeId: 'wt-1', tokens: 999 },
      { day: today, worktreeId: null, tokens: 999 }
    ]

    const grouped = groupTodayDailyByWorktree(rows)

    expect([...grouped.keys()].sort()).toEqual(['wt-1', 'wt-2'])
    expect(grouped.get('wt-1')).toEqual([rows[0], rows[1]])
    expect(grouped.get('wt-2')).toEqual([rows[2]])
  })

  it('returns an empty map when nothing happened today', () => {
    const grouped = groupTodayDailyByWorktree<DailyRow>([
      { day: '2020-01-01', worktreeId: 'wt-1', tokens: 100 }
    ])

    expect(grouped.size).toBe(0)
  })
})

type SessionRow = {
  sessionId: string
  lastTimestamp: string
  locationBreakdown: readonly { worktreeId: string | null }[]
}

describe('groupTodaySessionCountsByWorktree', () => {
  const today = getTodayLocalUsageDay()
  const todayTimestamp = `${today}T12:00:00.000Z`

  it('counts each session once per worktree even with duplicate locations', () => {
    const sessions: SessionRow[] = [
      {
        sessionId: 'session-1',
        lastTimestamp: todayTimestamp,
        locationBreakdown: [{ worktreeId: 'wt-1' }, { worktreeId: 'wt-1' }, { worktreeId: 'wt-2' }]
      },
      {
        sessionId: 'session-2',
        lastTimestamp: todayTimestamp,
        locationBreakdown: [{ worktreeId: 'wt-1' }]
      },
      {
        sessionId: 'session-3',
        lastTimestamp: '2020-01-01T12:00:00.000Z',
        locationBreakdown: [{ worktreeId: 'wt-1' }]
      }
    ]

    const counts = groupTodaySessionCountsByWorktree(sessions)

    expect(counts.get('wt-1')).toBe(2)
    expect(counts.get('wt-2')).toBe(1)
    expect(counts.has('wt-3')).toBe(false)
  })
})
