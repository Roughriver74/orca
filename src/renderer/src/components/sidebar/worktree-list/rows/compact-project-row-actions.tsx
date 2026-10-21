import React from 'react'
import type { AppState } from '@/store/types'
import { cn } from '@/lib/utils'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import { getRepoHeaderCreateState } from '../../repo-header-create-state'
import { ProjectHeaderActions } from '../../ProjectHeaderActions'
import type { GroupHeaderRow } from '../../../../../../shared/sidebar-list/row-types'
import type { WorktreeSidebarHeaderDrag } from '../drag/use-header-drag'
import {
  RepoHeaderCreateWorkspaceButton,
  RepoHeaderProjectActionsMenu,
  type RepoHeaderProjectActions
} from './repo-header-project-actions'

export type CompactProjectRowContext = {
  projectGroups: readonly ProjectGroup[]
  sshConnectionStates: AppState['sshConnectionStates']
  projectActions: RepoHeaderProjectActions
  headerDrag: WorktreeSidebarHeaderDrag
}

/** Repo-header drag wiring for a compact row, which stands in for its folded project header. */
export function getCompactProjectRowDrag(
  ctx: CompactProjectRowContext | undefined,
  header: GroupHeaderRow | undefined
): {
  attributes: Record<string, string | number | undefined>
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const repo = header?.repo
  if (!ctx || !repo) {
    return { attributes: {} }
  }
  const repoId = repo.id
  const drag = ctx.headerDrag
  const bucketKey = drag.repoHeaderBucketByRepoId.get(repoId)
  const draggable = Boolean(
    drag.canReorderRepoHeaders &&
    bucketKey &&
    (drag.sidebarRepoHeaderIdsByBucket.get(bucketKey)?.length ?? 0) > 1
  )
  return {
    attributes: {
      'data-compact-project-row': '',
      'data-repo-header-id': repoId,
      'data-repo-header-index': drag.repoHeaderIndexByRepoId.get(repoId),
      'data-repo-header-bucket': bucketKey,
      'data-repo-header-section-end': drag.repoHeaderSectionEndByRepoId.get(repoId),
      'data-repo-header-drag-handle': draggable ? '' : undefined
    },
    // Why: in Manual order the row moves its project, like the header it replaces.
    onPointerDown: draggable ? (event) => drag.repoDrag.onHandlePointerDown(event, repo) : undefined
  }
}

// Why: the folded header still owns project actions (… and +), so a compact row keeps them on
// hover, anchored to its title line so they never cover the agent rows listed below it.
export function CompactProjectRowActions({
  ctx,
  header,
  expanded
}: {
  ctx: CompactProjectRowContext
  header: GroupHeaderRow
  expanded: boolean
}): React.JSX.Element | null {
  const { repo } = header
  if (!repo) {
    return null
  }
  const label = header.label ?? repo.displayName
  const createState = getRepoHeaderCreateState({
    repo,
    label,
    sshGate: {
      connectionId: repo.connectionId ?? null,
      status: repo.connectionId
        ? (ctx.sshConnectionStates.get(repo.connectionId)?.status ?? null)
        : null
    }
  })
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 flex items-center justify-end pr-1',
        // Why: matches the card's title line (pt-1.25 + 20px once agent rows follow, else py-2).
        expanded ? 'h-[30px]' : 'h-9'
      )}
    >
      <ProjectHeaderActions
        data-compact-project-actions=""
        className="pointer-events-auto"
        // Why: the row's pointerdown arms a worktree or project drag; the action buttons must not.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <RepoHeaderProjectActionsMenu
          repo={repo}
          label={label}
          projectGroups={ctx.projectGroups}
          actions={ctx.projectActions}
        />
        <RepoHeaderCreateWorkspaceButton
          repo={repo}
          label={label}
          createState={createState}
          onCreateForRepo={ctx.projectActions.onCreateForRepo}
        />
      </ProjectHeaderActions>
    </div>
  )
}
