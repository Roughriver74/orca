import {
  getRepoExecutionHostId,
  getWorktreeExecutionHostId,
  type ExecutionHostId
} from '../execution-host'
import type { Repo } from '../repo-types'
import type { Row } from './row-types'
import { getFolderWorkspaceHostId } from './folder-workspace-host-id'

export function getRepoHostId(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | undefined,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  // Why: explicit executionHostId must win over the focused/default host, or
  // runtime-owned repos group under whichever host happens to be focused.
  if (repo?.connectionId || repo?.executionHostId) {
    return getRepoExecutionHostId(repo)
  }
  return defaultHostId
}

/** A project group's header (it names no host itself): its nesting depth, else null. */
export function getProjectGroupHeaderDepth(row: Row): number | null {
  return row.type === 'header' && row.projectGroup && !row.repo
    ? (row.projectGroupDepth ?? 0)
    : null
}

function resolveRowHosts(row: Row, defaultHostId: ExecutionHostId): ExecutionHostId[] {
  switch (row.type) {
    case 'item':
      return [getWorktreeExecutionHostId(row.worktree, row.repo, defaultHostId)]
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
      return [getRepoHostId(row.repo, defaultHostId)]
    case 'folder-workspace':
      return [getFolderWorkspaceHostId(row.folderWorkspace, row.projectGroup, defaultHostId)]
    case 'header':
      if (row.repo) {
        return [getRepoHostId(row.repo, defaultHostId)]
      }
      return row.hostWorktreeCounts ? [...row.hostWorktreeCounts.keys()] : []
  }
}

/** Every host a project-group header's own descendant rows (items, repos, nested groups) actually
 *  resolve to, from one pass over the flat already-DFS-ordered `rows` list — real membership, not
 *  the group's own (possibly stamped-by-a-reader, not authored) executionHostId/connectionId. */
export function computeProjectGroupActualHosts(
  rows: readonly Row[],
  defaultHostId: ExecutionHostId
): Map<Row, Set<ExecutionHostId>> {
  const hostsByGroupRow = new Map<Row, Set<ExecutionHostId>>()
  let stack: Extract<Row, { type: 'header' }>[] = []
  for (const row of rows) {
    if (row.type === 'header') {
      // Why: pop by the row's real nesting depth, for every header (group or not) — a sibling or
      // shallower header, group or plain repo/lane, ends the previous group's subtree, so its own
      // and its descendants' hosts stop counting toward that group's span.
      const depth = row.projectGroupDepth ?? 0
      stack = stack.filter((ancestor) => (getProjectGroupHeaderDepth(ancestor) ?? depth) < depth)
      if (getProjectGroupHeaderDepth(row) !== null) {
        hostsByGroupRow.set(row, new Set())
        stack.push(row)
        continue
      }
    }
    if (stack.length === 0) {
      continue
    }
    for (const hostId of resolveRowHosts(row, defaultHostId)) {
      for (const ancestor of stack) {
        hostsByGroupRow.get(ancestor)?.add(hostId)
      }
    }
  }
  return hostsByGroupRow
}
