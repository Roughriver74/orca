import type { WorktreeStatus } from '@/lib/worktree-status'

// Same precedence resolveWorktreeStatus applies across one workspace's panes.
const PROJECT_STATUS_PRECEDENCE: readonly WorktreeStatus[] = [
  'permission',
  'failed',
  'working',
  'monitoring',
  'unconfirmed',
  'interrupted',
  'done',
  'active',
  'inactive'
]

/** A folded project's dot: its most urgent workspace status, so a finished or idle
 *  workspace never hides one an agent is still working in. */
export function rollUpProjectStatus(
  statuses: ReadonlyMap<string, WorktreeStatus>
): WorktreeStatus | undefined {
  let best: WorktreeStatus | undefined
  let bestRank = PROJECT_STATUS_PRECEDENCE.length
  for (const status of statuses.values()) {
    const rank = PROJECT_STATUS_PRECEDENCE.indexOf(status)
    if (rank < bestRank) {
      best = status
      bestRank = rank
    }
  }
  return best
}
