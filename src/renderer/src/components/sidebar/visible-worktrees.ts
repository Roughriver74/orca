export type { SidebarFilterState } from './sidebar-filter-actions'
export {
  computeVisibleWorktreeIds,
  computeVisibleWorktrees,
  type VisibleWorktreeOptions
} from './compute-visible-worktrees'
import { computeVisibleWorktreeIds } from './compute-visible-worktrees'
export { sidebarHasActiveFilters } from './sidebar-filter-actions'
import {
  getVisibleWorkspaceHostIdSet,
  worktreeMatchesVisibleHost
} from './visible-worktree-host-scope'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  buildWorktreeComparator,
  sortWorktreesSmart
} from '../../../../shared/sidebar-list/smart-sort'
export {
  EMPTY_STRUCTURED_CHAT_WORKTREE_IDS,
  getWorktreeIdsWithStructuredChat
} from './visible-worktree-activity-inputs'
import { buildVisibleWorktreeOptionsFromState } from './visible-worktree-options-from-state'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { getAllWorktreesFromState, getRepoMapFromState } from '@/store/selectors'
import { getSettingsFocusedExecutionHostId } from '../../../../shared/execution-host'
import {
  computeRenderedSidebarRows,
  computeRenderedSidebarWorktreeOrder
} from './rendered-sidebar-worktree-order'
import { getSidebarShortcutTargets, type SidebarShortcutTarget } from './sidebar-shortcut-targets'
import { getPinnedWorktreeDisplayPolicy } from '../../../../shared/sidebar-list/row-types'

/**
 * Module-level cache of the visible worktree IDs as last computed by
 * WorktreeList's render pipeline.
 *
 * Why: WorktreeList freezes its sort order via sortedIds / sortEpoch useMemo
 * and only re-sorts when sortEpoch bumps. If getVisibleWorktreeIds()
 * recomputes sort order from a live Zustand snapshot, the Cmd+1–9 shortcut
 * could target a different worktree than what's rendered at that sidebar
 * position. By caching the IDs that WorktreeList actually rendered, the
 * shortcut numbering always matches the sidebar card order.
 *
 * Why null vs []: [] is a real rendered order (everything collapsed/filtered);
 * null means WorktreeList is unmounted.
 */
let _publishedVisibleIds: string[] | null = null
export type VisibleWorktreeShortcutTarget = SidebarShortcutTarget
let _publishedVisibleShortcutTargets: VisibleWorktreeShortcutTarget[] | null = null

export function setVisibleWorktreeIds(ids: string[] | null): void {
  _publishedVisibleIds = ids
}

export function setVisibleWorktreeShortcutTargets(
  targets: VisibleWorktreeShortcutTarget[] | null
): void {
  _publishedVisibleShortcutTargets = targets
}

export function getPublishedVisibleWorktreeShortcutTargets():
  | readonly VisibleWorktreeShortcutTarget[]
  | null {
  return _publishedVisibleShortcutTargets
}

export function getVisibleWorktreeIds(): string[] {
  // Prefer the published IDs that mirror the rendered sidebar order.
  if (_publishedVisibleIds) {
    return _publishedVisibleIds
  }
  const state = useAppStore.getState()
  // Why the row pipeline: grouping, pinning and main-worktree hoisting reorder cards, so a flat sort numbers the wrong workspace.
  return computeRenderedSidebarWorktreeOrder(state, getSidebarCandidateWorktrees(state))
}

/** Every workspace the sidebar may show (sorted, filtered), before grouping or folding. */
function getSidebarCandidateWorktrees(state: AppState): Worktree[] {
  const allWorktrees = getAllWorktreesFromState(state).filter((w) => !w.isArchived)

  // Hoist repoMap so it's built once and reused across all branches below.
  const repoMap = getRepoMapFromState(state)

  let sortedIds: string[]

  if (state.sortBy === 'smart') {
    sortedIds = sortWorktreesSmart(
      allWorktrees,
      state.tabsByWorktree,
      repoMap,
      state.agentStatusByPaneKey,
      state.runtimePaneTitlesByTabId,
      state.ptyIdsByTabId,
      state.migrationUnsupportedByPtyId,
      state.terminalLayoutsByTabId
    ).map((w) => w.id)
  } else {
    // Why empty map: non-smart branches don't read attentionByWorktree, but
    // the param is required to keep smart-mode callers honest at the type level.
    const sorted = [...allWorktrees].sort(
      buildWorktreeComparator(state.sortBy, repoMap, Date.now(), new Map())
    )
    sortedIds = sorted.map((w) => w.id)
  }

  const visibleIds = computeVisibleWorktreeIds(
    state.worktreesByRepo,
    sortedIds,
    buildVisibleWorktreeOptionsFromState(state, repoMap)
  )

  const visibleIdRank = new Map(visibleIds.map((id, index) => [id, index]))
  const visibleHostIds = getVisibleWorkspaceHostIdSet(state)
  const defaultHostId = getSettingsFocusedExecutionHostId(state.settings)
  return allWorktrees
    .filter(
      (worktree) =>
        visibleIdRank.has(worktree.id) &&
        worktreeMatchesVisibleHost(worktree, visibleHostIds, repoMap, defaultHostId)
    )
    .sort((a, b) => (visibleIdRank.get(a.id) ?? 0) - (visibleIdRank.get(b.id) ?? 0))
}

export function getVisibleWorktreeShortcutTargets(): VisibleWorktreeShortcutTarget[] {
  if (_publishedVisibleShortcutTargets) {
    return _publishedVisibleShortcutTargets
  }
  const state = useAppStore.getState()
  // Why candidates, not rendered ids: a folded compact project renders no card yet owns a slot.
  const targets = getSidebarShortcutTargets(
    computeRenderedSidebarRows(state, getSidebarCandidateWorktrees(state)),
    getPinnedWorktreeDisplayPolicy(state.settings)
  )
  // Lineage keys are contextual to the rendered sidebar hierarchy; unmounted shortcuts (palette, etc.)
  // operate on global visible worktrees without lineage nesting, so strip them for consistency.
  return targets.map((target) => {
    const { lineageGroupKey: _, ...rest } = target
    return rest as VisibleWorktreeShortcutTarget
  })
}
