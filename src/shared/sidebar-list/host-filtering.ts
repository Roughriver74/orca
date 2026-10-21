import {
  ALL_EXECUTION_HOSTS_SCOPE,
  getWorktreeExecutionHostId,
  normalizeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId,
  type ExecutionHostScope
} from '../execution-host'
import type { FolderWorkspace } from '../folder-workspace-types'
import type { ProjectGroup } from '../project-group-types'
import type { Repo } from '../repo-types'

/** null means "no host filter" — every host is visible. */
export function getVisibleSidebarHostIdSet(
  visibleWorkspaceHostIds: readonly ExecutionHostId[] | null | undefined,
  workspaceHostScope: ExecutionHostScope
): Set<ExecutionHostId> | null {
  const visibleHostIds =
    visibleWorkspaceHostIds ??
    (workspaceHostScope === ALL_EXECUTION_HOSTS_SCOPE ? null : [workspaceHostScope])
  return visibleHostIds ? new Set<ExecutionHostId>(visibleHostIds) : null
}

// Why shared: the sidebar render path and the Cmd+1–9 order must apply the same
// host filtering, or the numbering drifts from the cards whenever a filter is on.
export function filterProjectGroupsForVisibleHosts(
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly ProjectGroup[] {
  if (!visibleHostIdSet) {
    return projectGroups
  }
  return projectGroups.filter((group) =>
    visibleHostIdSet.has(getProjectGroupExecutionHostIdForRows(group, defaultHostId))
  )
}

export function filterReposForVisibleHosts(
  repos: readonly Repo[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly Repo[] {
  return visibleHostIdSet
    ? repos.filter((repo) =>
        visibleHostIdSet.has(getWorktreeExecutionHostId({}, repo, defaultHostId))
      )
    : repos
}

export function filterFolderWorkspacesForVisibleHosts(
  folderWorkspaces: readonly FolderWorkspace[],
  projectGroups: readonly ProjectGroup[],
  visibleHostIdSet: ReadonlySet<ExecutionHostId> | null,
  defaultHostId: ExecutionHostId
): readonly FolderWorkspace[] {
  if (!visibleHostIdSet) {
    return folderWorkspaces
  }
  const projectGroupById = new Map(projectGroups.map((group) => [group.id, group]))
  return folderWorkspaces.filter((folderWorkspace) =>
    visibleHostIdSet.has(
      getFolderWorkspaceExecutionHostIdForRows({
        folderWorkspace,
        projectGroup: projectGroupById.get(folderWorkspace.projectGroupId),
        defaultHostId
      })
    )
  )
}

export function getProjectGroupExecutionHostIdForRows(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>,
  defaultHostId: ExecutionHostId
): ExecutionHostId {
  const executionHostId = normalizeExecutionHostId(group.executionHostId)
  if (executionHostId) {
    return executionHostId
  }
  return group.connectionId ? toSshExecutionHostId(group.connectionId) : defaultHostId
}

/** Whether a group names its own host, vs. a catalog-wide group the default host merely stands
 *  in for (`getProjectGroupExecutionHostIdForRows` always returns a concrete id either way). A
 *  host-named group pins to one host section; a catalog-wide group's header repeats in every
 *  host section its member repos span. */
export function projectGroupHasExplicitExecutionHost(
  group: Pick<ProjectGroup, 'connectionId' | 'executionHostId'>
): boolean {
  return normalizeExecutionHostId(group.executionHostId) !== null || !!group.connectionId
}

export function getFolderWorkspaceExecutionHostIdForRows({
  folderWorkspace,
  projectGroup,
  defaultHostId
}: {
  folderWorkspace: Pick<FolderWorkspace, 'connectionId' | 'executionHostId'>
  projectGroup: Pick<ProjectGroup, 'connectionId' | 'executionHostId'> | undefined
  defaultHostId: ExecutionHostId
}): ExecutionHostId {
  const explicitFolderHostId = normalizeExecutionHostId(folderWorkspace.executionHostId)
  if (explicitFolderHostId) {
    return explicitFolderHostId
  }
  if (projectGroup) {
    const explicitProjectGroupHostId = normalizeExecutionHostId(projectGroup.executionHostId)
    if (explicitProjectGroupHostId) {
      return explicitProjectGroupHostId
    }
    const projectGroupHostId = getProjectGroupExecutionHostIdForRows(projectGroup, defaultHostId)
    if (projectGroupHostId !== defaultHostId || !folderWorkspace.connectionId) {
      return projectGroupHostId
    }
  }
  return folderWorkspace.connectionId
    ? toSshExecutionHostId(folderWorkspace.connectionId)
    : defaultHostId
}
