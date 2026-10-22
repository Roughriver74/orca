import { LOCAL_EXECUTION_HOST_ID, type ExecutionHostId } from '../execution-host'
import type { Row } from './row-types'
import type { HostSectionOption } from './host-section-rows'

export function getFallbackHost(
  hostId: ExecutionHostId,
  localHostLabel: string
): HostSectionOption {
  const isLocal = hostId === LOCAL_EXECUTION_HOST_ID
  return {
    id: hostId,
    kind: isLocal ? 'local' : hostId.startsWith('ssh:') ? 'ssh' : 'runtime',
    label: isLocal ? localHostLabel : hostId,
    detail: isLocal ? 'This computer' : 'Host',
    health: isLocal ? 'local' : 'available'
  }
}

export function countWorkspaceRows(rows: readonly Row[]): number {
  // Why: a collapsed repo group contributes a header row but no item rows;
  // fall back to the header's own count so the host badge doesn't read 0
  // while a visibly populated project sits right under it.
  let count = 0
  const seenWorktreeIds = new Set<string>()
  let pendingHeader: Extract<Row, { type: 'header' }> | null = null
  let pendingHeaderHadWorkspaces = false
  const flushHeader = (): void => {
    if (pendingHeader && !pendingHeaderHadWorkspaces) {
      if (pendingHeader.worktreeIds) {
        const headerWorktreeIds = new Set(pendingHeader.worktreeIds)
        for (const worktreeId of pendingHeader.worktreeIds) {
          if (!seenWorktreeIds.has(worktreeId)) {
            count += 1
            seenWorktreeIds.add(worktreeId)
          }
        }
        // Folder workspaces contribute to the header count but have no worktree id.
        count += Math.max(0, pendingHeader.count - headerWorktreeIds.size)
      } else {
        count += pendingHeader.count
      }
    }
    pendingHeader = null
    pendingHeaderHadWorkspaces = false
  }
  for (const row of rows) {
    if (row.type === 'header') {
      flushHeader()
      pendingHeader = row
      continue
    }
    if (row.type === 'item') {
      if (!seenWorktreeIds.has(row.worktree.id)) {
        count += 1
        seenWorktreeIds.add(row.worktree.id)
      }
      pendingHeaderHadWorkspaces = pendingHeader !== null
      continue
    }
    if (row.type === 'folder-workspace') {
      count += 1
      pendingHeaderHadWorkspaces = pendingHeader !== null
    }
  }
  flushHeader()
  return count
}
