import { LOCAL_EXECUTION_HOST_ID, getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { Repo } from '../../../../shared/repo-types'

// Why a palette distinct from project colors: the left bar marks the host and the card wash marks
// the project, so the two channels must not read as the same signal.
const HOST_TINTS = ['#38bdf8', '#a78bfa', '#f59e0b', '#84cc16', '#fb7185', '#2dd4bf'] as const

/** Stable per-host color for remote (SSH/runtime) workspaces; local workspaces stay untinted. */
export function resolveHostCardTint(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined
): string | null {
  if (!repo) {
    return null
  }
  const hostId = getRepoExecutionHostId(repo)
  if (hostId === LOCAL_EXECUTION_HOST_ID) {
    return null
  }
  let hash = 0
  for (let index = 0; index < hostId.length; index++) {
    hash = (hash * 31 + hostId.charCodeAt(index)) >>> 0
  }
  return HOST_TINTS[hash % HOST_TINTS.length]
}
