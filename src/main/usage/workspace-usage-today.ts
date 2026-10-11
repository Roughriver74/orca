import { getLocalUsageDay, getTodayLocalUsageDay } from './usage-calendar-range'

/** Today's daily aggregate rows, grouped by the Orca worktree they are attributed to.
 *  Rows with no worktree (usage outside any known Orca workspace) are dropped. */
export function groupTodayDailyByWorktree<T extends { day: string; worktreeId: string | null }>(
  daily: readonly T[]
): Map<string, T[]> {
  const today = getTodayLocalUsageDay()
  const byWorktree = new Map<string, T[]>()
  for (const entry of daily) {
    if (entry.day !== today || entry.worktreeId === null) {
      continue
    }
    const rows = byWorktree.get(entry.worktreeId)
    if (rows) {
      rows.push(entry)
    } else {
      byWorktree.set(entry.worktreeId, [entry])
    }
  }
  return byWorktree
}

/** Distinct sessions today, grouped by every worktree they touched. */
export function groupTodaySessionCountsByWorktree<
  T extends {
    sessionId: string
    lastTimestamp: string
    locationBreakdown: readonly { worktreeId: string | null }[]
  }
>(sessions: readonly T[]): Map<string, number> {
  const today = getTodayLocalUsageDay()
  const sessionIdsByWorktree = new Map<string, Set<string>>()
  for (const session of sessions) {
    if (getLocalUsageDay(session.lastTimestamp) !== today) {
      continue
    }
    for (const location of session.locationBreakdown) {
      if (location.worktreeId === null) {
        continue
      }
      const sessionIds = sessionIdsByWorktree.get(location.worktreeId)
      if (sessionIds) {
        sessionIds.add(session.sessionId)
      } else {
        sessionIdsByWorktree.set(location.worktreeId, new Set([session.sessionId]))
      }
    }
  }
  const counts = new Map<string, number>()
  for (const [worktreeId, sessionIds] of sessionIdsByWorktree) {
    counts.set(worktreeId, sessionIds.size)
  }
  return counts
}
