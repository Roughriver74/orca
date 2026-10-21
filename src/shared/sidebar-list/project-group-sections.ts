import type { OccurrenceSectionPath } from '../worktree-occurrence-plan'
import type { FolderWorkspaceComparator, RenderableFolderWorkspace } from './folder-workspace-lanes'
import type { ProjectGroup } from '../project-group-types'
import type { ProjectOrderBy } from '../ui-chrome-types'
import { getDistinctProjectGroups, getEffectiveProjectGroupManualRank } from '../project-groups'
import {
  LOCAL_EXECUTION_HOST_ID,
  getRepoExecutionHostId,
  parseExecutionHostId
} from '../execution-host'
import { getProjectGroupHeaderKey } from './group-keys'
import { appendOrderedGroups } from './group-sections'
import { compareCodePoints, compareSidebarText } from './text-order'
import type { SectionAppendContext } from './group-sections'
import type { OrderedGroupEntry } from './worktree-group-entry'
import {
  compareRecentRank,
  createRecentRankLookup,
  withRepoSectionDisplayLabels
} from '../project-section-order'
import { buildFolderWorkspaceRow } from './row-builders'
import {
  compareProjectAttentionRank,
  createProjectAttentionRankLookup,
  type ProjectAttentionByWorktree
} from './project-attention-rank'

/**
 * Ids whose copies, taken together across hosts, would loop if resolved by bare id (#30045's
 * dedup picks one copy per id; that is only safe when the dropped copies' own parent links do not
 * depend on ANOTHER duplicated id also picking a specific copy — e.g. host A's copy of X parents
 * host B's copy of Y while host B's copy of Y parents host A's copy of X). Those ids are exempted
 * from the dedup below so every host keeps its own acyclic copy instead of losing one side.
 */
function findDuplicatedIdsFormingParentCycles(projectGroups: readonly ProjectGroup[]): Set<string> {
  const idCounts = new Map<string, number>()
  for (const group of projectGroups) {
    idCounts.set(group.id, (idCounts.get(group.id) ?? 0) + 1)
  }
  const duplicatedIds = new Set([...idCounts].filter(([, count]) => count > 1).map(([id]) => id))
  if (duplicatedIds.size === 0) {
    return duplicatedIds
  }
  const parentsById = new Map<string, Set<string>>()
  for (const group of projectGroups) {
    if (!duplicatedIds.has(group.id) || !group.parentGroupId) {
      continue
    }
    if (!duplicatedIds.has(group.parentGroupId)) {
      continue
    }
    const parents = parentsById.get(group.id) ?? new Set<string>()
    parents.add(group.parentGroupId)
    parentsById.set(group.id, parents)
  }
  const idsInCycle = new Set<string>()
  const UNVISITED = 0
  const VISITING = 1
  const DONE = 2
  const state = new Map<string, number>()
  const path: string[] = []
  const visit = (id: string): void => {
    state.set(id, VISITING)
    path.push(id)
    for (const parentId of parentsById.get(id) ?? []) {
      const parentState = state.get(parentId) ?? UNVISITED
      if (parentState === VISITING) {
        const cycleStart = path.indexOf(parentId)
        for (let index = cycleStart; index < path.length; index += 1) {
          idsInCycle.add(path[index])
        }
      } else if (parentState === UNVISITED) {
        visit(parentId)
      }
    }
    path.pop()
    state.set(id, DONE)
  }
  for (const id of duplicatedIds) {
    if ((state.get(id) ?? UNVISITED) === UNVISITED) {
      visit(id)
    }
  }
  return idsInCycle
}

export function appendProjectGroupSections(
  ctx: SectionAppendContext,
  args: {
    orderedGroups: OrderedGroupEntry[]
    projectGroups: readonly ProjectGroup[]
    folderWorkspaces: readonly RenderableFolderWorkspace[]
    compareFolderWorkspaces: FolderWorkspaceComparator
    projectOrderBy: ProjectOrderBy
    repoOrder: Map<string, number> | undefined
    projectAttentionByWorktree?: ProjectAttentionByWorktree
  }
): void {
  const {
    orderedGroups,
    projectGroups,
    folderWorkspaces,
    compareFolderWorkspaces,
    projectOrderBy,
    repoOrder
  } = args
  const { result, collapsedGroups } = ctx

  const groupByProjectGroupId = new Map<string | null, OrderedGroupEntry[]>()
  for (const entry of orderedGroups) {
    const repo = entry[1].repo
    const projectGroupId = repo?.projectGroupId ?? null
    const list = groupByProjectGroupId.get(projectGroupId) ?? []
    list.push(entry)
    groupByProjectGroupId.set(projectGroupId, list)
  }

  const sortRepoEntriesWithinGroup = (entries: OrderedGroupEntry[]): OrderedGroupEntry[] => {
    if (projectOrderBy === 'attention') {
      if (entries.length < 2) {
        return [...entries]
      }
      const getAttentionRank = createProjectAttentionRankLookup(args.projectAttentionByWorktree)
      return [...entries].sort(
        (left, right) =>
          compareProjectAttentionRank(getAttentionRank(left), getAttentionRank(right)) ||
          getEffectiveProjectGroupManualRank(left[1].repo, repoOrder) -
            getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      )
    }
    if (projectOrderBy === 'recent') {
      if (entries.length < 2) {
        return [...entries]
      }
      const getRecentRank = createRecentRankLookup()
      return [...entries].sort((left, right) =>
        compareRecentRank(getRecentRank(left), getRecentRank(right))
      )
    }
    // Manual: within a Project Group, projects order by their per-group rank
    // (projectGroupOrder), falling back to global repoOrder when unset so drag
    // midpoint commits and the rendered order stay aligned.
    return [...entries].sort((left, right) => {
      const leftRank = getEffectiveProjectGroupManualRank(left[1].repo, repoOrder)
      const rightRank = getEffectiveProjectGroupManualRank(right[1].repo, repoOrder)
      return leftRank - rightRank
    })
  }

  const projectGroupsById = new Map(projectGroups.map((group) => [group.id, group]))
  // Membership already decided by getRenderableFolderWorkspaces in planSidebarRows, so
  // repo grouping no longer owns the filter — it only groups and orders (#15362).
  const folderWorkspacesByProjectGroupId = new Map<string, RenderableFolderWorkspace[]>()
  for (const pair of folderWorkspaces) {
    const groupId = pair.folderWorkspace.projectGroupId
    const list = folderWorkspacesByProjectGroupId.get(groupId) ?? []
    list.push(pair)
    folderWorkspacesByProjectGroupId.set(groupId, list)
  }
  for (const list of folderWorkspacesByProjectGroupId.values()) {
    list.sort((left, right) => compareFolderWorkspaces(left.folderWorkspace, right.folderWorkspace))
  }
  // Why: ids repeat across hosts and each host nests its own copies, so a parent link resolves
  // only inside the group's catalog; linking by bare id could turn two acyclic hosts into a loop.
  const catalogGroupKey = (group: ProjectGroup, id: string): string => {
    const hostId = getRepoExecutionHostId(group)
    const catalogHostId =
      parseExecutionHostId(hostId)?.kind === 'runtime' ? hostId : LOCAL_EXECUTION_HOST_ID
    return `${catalogHostId}\u0000${id}`
  }
  const catalogGroupKeys = new Set(projectGroups.map((group) => catalogGroupKey(group, group.id)))
  const childGroupsByParentKey = new Map<string | null, ProjectGroup[]>()
  // Why distinct: membership is id-keyed, so a same-id copy's header would sit empty (#30045).
  // A duplicated id involved in a cross-host parent cycle is the exception: picking one copy
  // would strand the other's own subtree, so every copy of those ids renders on its own host.
  const idsInParentCycles = findDuplicatedIdsFormingParentCycles(projectGroups)
  const groupsToNest =
    idsInParentCycles.size === 0
      ? getDistinctProjectGroups(projectGroups)
      : [
          ...getDistinctProjectGroups(
            projectGroups.filter((group) => !idsInParentCycles.has(group.id))
          ),
          ...projectGroups.filter((group) => idsInParentCycles.has(group.id))
        ]
  for (const group of groupsToNest) {
    const parentKey = group.parentGroupId ? catalogGroupKey(group, group.parentGroupId) : null
    const key = parentKey && catalogGroupKeys.has(parentKey) ? parentKey : null
    const children = childGroupsByParentKey.get(key) ?? []
    children.push(group)
    childGroupsByParentKey.set(key, children)
  }
  for (const groups of childGroupsByParentKey.values()) {
    groups.sort(
      (left, right) =>
        left.tabOrder - right.tabOrder ||
        compareSidebarText(left.name, right.name) ||
        compareCodePoints(left.executionHostId ?? '', right.executionHostId ?? '') ||
        compareCodePoints(left.id, right.id)
    )
  }
  const getChildGroups = (group: ProjectGroup): ProjectGroup[] =>
    childGroupsByParentKey.get(catalogGroupKey(group, group.id)) ?? []

  const getProjectGroupSubtreeCount = (group: ProjectGroup): number => {
    const directCount = groupByProjectGroupId.get(group.id)?.length ?? 0
    const folderWorkspaceCount = folderWorkspacesByProjectGroupId.get(group.id)?.length ?? 0
    return getChildGroups(group).reduce(
      (count, child) => count + getProjectGroupSubtreeCount(child),
      directCount + folderWorkspaceCount
    )
  }

  const appendProjectGroup = (projectGroup: ProjectGroup, depth: number): void => {
    const repoEntries = sortRepoEntriesWithinGroup(groupByProjectGroupId.get(projectGroup.id) ?? [])
    const childGroups = getChildGroups(projectGroup)
    const key = getProjectGroupHeaderKey(projectGroup.id)
    result.push({
      type: 'header',
      key,
      label: projectGroup.name,
      count: getProjectGroupSubtreeCount(projectGroup),
      icon: { kind: 'project' },
      projectGroup,
      projectGroupDepth: depth
    })
    if (!collapsedGroups.has(key)) {
      for (const pair of folderWorkspacesByProjectGroupId.get(projectGroup.id) ?? []) {
        result.push(buildFolderWorkspaceRow(pair, depth + 1))
      }
      appendOrderedGroups(ctx, withRepoSectionDisplayLabels(repoEntries), depth + 1)
      for (const childGroup of childGroups) {
        appendProjectGroup(childGroup, depth + 1)
      }
    }
    groupByProjectGroupId.delete(projectGroup.id)
  }

  for (const projectGroup of childGroupsByParentKey.get(null) ?? []) {
    appendProjectGroup(projectGroup, 0)
  }

  const remainingRepoEntries = [...(groupByProjectGroupId.get(null) ?? [])]
  for (const [projectGroupId, entries] of groupByProjectGroupId) {
    if (projectGroupId === null || projectGroupsById.has(projectGroupId)) {
      continue
    }
    // Why: startup can have repos from hosts whose project-group metadata was
    // not fetched yet; missing metadata must not make those repos disappear.
    remainingRepoEntries.push(...entries)
  }
  appendOrderedGroups(
    ctx,
    withRepoSectionDisplayLabels(sortRepoEntriesWithinGroup(remainingRepoEntries)),
    0
  )
}

/** The same group parents used by section emission, including missing-parent roots. */
export function getProjectGroupOccurrencePaths(projectGroups: readonly ProjectGroup[]) {
  const groupsById = new Map(projectGroups.map((group) => [group.id, group]))
  const paths = new Map<string, OccurrenceSectionPath>()
  for (const group of getDistinctProjectGroups(projectGroups)) {
    const pending: ProjectGroup[] = []
    const seen = new Set<string>()
    let current: ProjectGroup | undefined = group
    while (current && !paths.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id)
      pending.push(current)
      current = current.parentGroupId ? groupsById.get(current.parentGroupId) : undefined
    }
    let parent = current ? paths.get(current.id) : undefined
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index]
      const path: OccurrenceSectionPath = { key: getProjectGroupHeaderKey(entry.id), parent }
      paths.set(entry.id, path)
      parent = path
    }
  }
  return paths
}
