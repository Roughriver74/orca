import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getWorktreeExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostKind,
  type ExecutionHostScope
} from '../execution-host'
import type { ExecutionHostHealth } from '../execution-host-registry'
import type { RuntimeCompatVerdict } from '../protocol-compat'
import type { RuntimeHostBlockedReason } from '../runtime-host-status'
import type { SshConnectionStatus } from '../ssh-types'
import type { Row } from './row-types'
import { getFolderWorkspaceHostId } from './folder-workspace-host-id'
import {
  getProjectGroupExecutionHostIdForRows,
  projectGroupHasExplicitExecutionHost
} from './host-filtering'
import {
  computeProjectGroupActualHosts,
  getProjectGroupHeaderDepth,
  getRepoHostId
} from './project-group-host-spans'
import { countWorkspaceRows, getFallbackHost } from './host-section-row-helpers'

export type HostHeaderRow = {
  type: 'host-header'
  key: string
  hostId: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  // Why: blocked-host guidance in the header menu needs the verdict reason so
  // it can deep-link an "Update server/client required" row per skew direction.
  compatibility?: RuntimeCompatVerdict
  // Why: a revoked pairing needs "Re-pair", not the update guidance a version block gets.
  blockedReason?: RuntimeHostBlockedReason
  connectionStatus?: SshConnectionStatus
  collapsed: boolean
  count: number
}

export type HostSectionRow = Row | HostHeaderRow

export type HostSectionOption = {
  id: ExecutionHostId
  kind: ExecutionHostKind
  label: string
  detail: string
  health: ExecutionHostHealth
  compatibility?: RuntimeCompatVerdict
  blockedReason?: RuntimeHostBlockedReason
  connectionStatus?: SshConnectionStatus
}

function getRowHostId(
  row: Row,
  defaultHostId: ExecutionHostId,
  projectGroupActualHosts?: ReadonlyMap<Row, ReadonlySet<ExecutionHostId>>
): ExecutionHostId | null {
  switch (row.type) {
    case 'item':
      return getWorktreeExecutionHostId(row.worktree, row.repo, defaultHostId)
    case 'pending-creation':
    case 'imported-worktrees-card':
    case 'new-external-worktrees-inbox':
      return getRepoHostId(row.repo, defaultHostId)
    case 'folder-workspace':
      return getFolderWorkspaceHostId(row.folderWorkspace, row.projectGroup, defaultHostId)
    case 'header': {
      if (row.repo) {
        return getRepoHostId(row.repo, defaultHostId)
      }
      if (!row.projectGroup || row.projectGroup.id === null) {
        return null
      }
      // Why: a project group lives in one host's catalog; buffered like a lane header it floated
      // above the host cards and capped that host's ungrouped projects. Prefer its real descendant
      // membership over its stored executionHostId/connectionId stamp: the feed/mobile catalog
      // (buildSidebarProjectCatalog) stamps every own-host group as local regardless of where its
      // members actually live, which would otherwise wrongly pin a genuinely cross-host catalog-wide
      // group to one section instead of letting it float into every host it spans, like the desktop
      // window (reading the store directly, unstamped) already does.
      const actualHosts = projectGroupActualHosts?.get(row)
      if (actualHosts && actualHosts.size > 0) {
        return actualHosts.size === 1 ? [...actualHosts][0] : null
      }
      // No resolvable descendants right now (empty, not-yet-loaded, or its subtree is collapsed
      // so its rows never reached this pass): fall back to its own stamp.
      return projectGroupHasExplicitExecutionHost(row.projectGroup)
        ? getProjectGroupExecutionHostIdForRows(row.projectGroup, defaultHostId)
        : null
    }
  }
}

function localizePendingRowsForHost(
  rows: readonly Extract<Row, { type: 'header' }>[],
  hostId: ExecutionHostId
): Extract<Row, { type: 'header' }>[] {
  const localized: Extract<Row, { type: 'header' }>[] = []
  for (const row of rows) {
    if (!row.hostWorktreeCounts) {
      // Why: a cross-host group header repeats per host section; its hostId keeps render keys unique.
      localized.push(row.hostId === hostId ? row : { ...row, hostId })
      continue
    }
    const count = row.hostWorktreeCounts.get(hostId)
    if (count !== undefined && count > 0) {
      localized.push({
        ...row,
        count,
        hostId,
        worktreeIds: row.hostWorktreeIds?.get(hostId) ?? row.worktreeIds
      })
    }
  }
  return localized
}

function getPendingRowKey(row: Extract<Row, { type: 'header' }>): string {
  return `${row.key}:${row.count}:${row.worktreeIds?.join(',') ?? ''}`
}

export function addHostSectionRows(args: {
  rows: readonly Row[]
  hostOptions: readonly HostSectionOption[]
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  /** The listed host's own name for itself; a phone reader must not derive it from its own platform. */
  localHostLabel: string
  // Why: host sections reuse the sidebar's persisted collapsed-group keys
  // (`host:<hostId>`) so collapse state survives restarts like other groups.
  collapsedHostKeys?: ReadonlySet<string>
  forceCollapseHosts?: boolean
  // Why: in the default Projects view, project is the user's primary object
  // and host is context inside it. Explicit host filters still keep host
  // headers as an operational/troubleshooting view.
  preferProjectGrouping?: boolean
}): HostSectionRow[] {
  const visibleHostIds =
    args.visibleWorkspaceHostIds ??
    (args.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [args.workspaceHostScope])
  if (
    args.preferProjectGrouping &&
    args.workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE &&
    !args.visibleWorkspaceHostIds
  ) {
    return [...args.rows]
  }
  if ((visibleHostIds && visibleHostIds.length <= 1) || args.hostOptions.length <= 1) {
    return [...args.rows]
  }

  const hostOptionsById = new Map(args.hostOptions.map((host) => [host.id, host]))
  const rowsByHostId = new Map<ExecutionHostId, Row[]>()
  const globalRows: Row[] = []
  // The headers above the next host-owned row: one lane header, or a project group's path.
  let pendingRows: Extract<Row, { type: 'header' }>[] = []
  const usedPendingRows = new Set<Row>()
  // Each host's last emitted header path, so a sibling group repeats only what differs.
  const emittedPathByHostId = new Map<ExecutionHostId, string[]>()
  const flushUnusedPendingRows = (rows: readonly Extract<Row, { type: 'header' }>[]): void => {
    const unused = rows.filter((row) => !usedPendingRows.has(row))
    if (unused.length === 0) {
      return
    }
    const hostScopedRow = unused.some((row) => row.hostWorktreeCounts)
    if (!hostScopedRow) {
      globalRows.push(...unused)
      return
    }
    for (const row of unused) {
      for (const [hostId, count] of row.hostWorktreeCounts ?? []) {
        if (count <= 0) {
          continue
        }
        const hostRows = rowsByHostId.get(hostId) ?? []
        const hostIds = row.hostWorktreeIds?.get(hostId)
        hostRows.push({
          ...row,
          count,
          hostId,
          worktreeIds: hostIds ?? row.worktreeIds
        })
        rowsByHostId.set(hostId, hostRows)
      }
    }
  }
  const projectGroupActualHosts = computeProjectGroupActualHosts(args.rows, args.defaultHostId)

  for (const row of args.rows) {
    const rowHostId = getRowHostId(row, args.defaultHostId, projectGroupActualHosts)
    if (row.type === 'header') {
      const depth = getProjectGroupHeaderDepth(row)
      if (depth !== null) {
        // A nested group keeps its ancestors pending, so each host section gets the whole path.
        // A sibling or shallower group header — host-named or not — ends the prior group's reach,
        // so a host-direct header must trim stale pending ancestors just like a floating one does.
        const kept =
          depth > 0
            ? pendingRows.filter(
                (pending) => (getProjectGroupHeaderDepth(pending) ?? depth) < depth
              )
            : []
        flushUnusedPendingRows(pendingRows.filter((pending) => !kept.includes(pending)))
        pendingRows = kept
        if (!rowHostId) {
          pendingRows = [...kept, row]
          continue
        }
        // A host-named group: falls through to push itself directly below, using the trimmed
        // ancestor chain rather than any stale sibling group's leftover pending headers.
      }
    }
    if (rowHostId) {
      const hostRows = rowsByHostId.get(rowHostId) ?? []
      const localizedPendingRows = localizePendingRowsForHost(pendingRows, rowHostId)
      const path = localizedPendingRows.map(getPendingRowKey)
      const emitted = emittedPathByHostId.get(rowHostId) ?? []
      let shared = 0
      while (shared < path.length && path[shared] === emitted[shared]) {
        shared += 1
      }
      if (shared < path.length || path.length !== emitted.length) {
        hostRows.push(...localizedPendingRows.slice(shared))
        emittedPathByHostId.set(rowHostId, path)
      }
      if (localizedPendingRows.length > 0) {
        pendingRows.forEach((pendingRow) => usedPendingRows.add(pendingRow))
      }
      hostRows.push(row)
      rowsByHostId.set(rowHostId, hostRows)
      continue
    }
    // Why: status/"All" headers describe the rows that follow. Buffer them
    // for every host-owned run so host remains above the existing grouping.
    if (row.type === 'header') {
      flushUnusedPendingRows(pendingRows)
      pendingRows = [row]
    } else {
      globalRows.push(row)
    }
  }

  flushUnusedPendingRows(pendingRows)

  const hostOrder: ExecutionHostId[] = []
  for (const host of args.hostOptions) {
    if (rowsByHostId.has(host.id)) {
      hostOrder.push(host.id)
    }
  }
  for (const hostId of rowsByHostId.keys()) {
    if (!hostOptionsById.has(hostId)) {
      hostOrder.push(hostId)
    }
  }

  // Why: a lone host section is pure noise — the grouping only earns its keep
  // when there are at least two host sections to tell apart. Registered-but-
  // empty hosts stay visible in the scope picker, not as headers.
  if (rowsByHostId.size <= 1) {
    return [...args.rows]
  }

  const result: HostSectionRow[] = [...globalRows]
  for (const hostId of hostOrder) {
    const hostRows = rowsByHostId.get(hostId)
    if (!hostRows || hostRows.length === 0) {
      continue
    }
    const host = hostOptionsById.get(hostId) ?? getFallbackHost(hostId, args.localHostLabel)
    const collapsed =
      args.forceCollapseHosts || (args.collapsedHostKeys?.has(`host:${host.id}`) ?? false)
    result.push({
      type: 'host-header',
      key: `host:${host.id}`,
      hostId: host.id,
      kind: host.kind,
      label: host.label,
      detail: host.detail,
      health: host.health,
      compatibility: host.compatibility,
      ...(host.blockedReason ? { blockedReason: host.blockedReason } : {}),
      connectionStatus: host.connectionStatus,
      collapsed,
      count: countWorkspaceRows(hostRows)
    })
    if (!collapsed) {
      result.push(...hostRows)
    }
  }

  return result
}
