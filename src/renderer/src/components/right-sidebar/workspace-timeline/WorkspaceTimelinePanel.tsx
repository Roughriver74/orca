import React, { useMemo } from 'react'
import { History } from 'lucide-react'
import { useAppStore } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { useWorkspaceTimelineStore } from '@/store/workspace-timeline-store'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { translate } from '@/i18n/i18n'
import { isFolderRepo } from '../../../../../shared/repo-kind'
import { parseWorkspaceKey } from '../../../../../shared/workspace-scope'
import { mergeWorkspaceTimelineEntries } from './workspace-timeline-merge'
import { useWorkspaceTimelineCommits } from './use-workspace-timeline-commits'
import { useOpenWorkspaceTimelineCommit } from './use-workspace-timeline-commit-open'
import { useOpenWorkspaceTimelineFile } from './use-workspace-timeline-file-open'
import { WorkspaceTimelineRow } from './workspace-timeline-row'
import type {
  WorkspaceTimelineEntry,
  WorkspaceTimelinePersistedEntry
} from './workspace-timeline-types'

const EMPTY_PERSISTED_ENTRIES: WorkspaceTimelinePersistedEntry[] = []
const EMPTY_COMMIT_ENTRIES: WorkspaceTimelineEntry[] = []

/** Chronological per-workspace feed: prompts, agent state transitions, files touched, and
 *  commits, merged newest-first. Prompts/transitions/files are captured live and persisted
 *  locally (not recoverable from git); commits are read fresh from the execution host. */
export default function WorkspaceTimelinePanel(): React.JSX.Element {
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const activeWorktree = useActiveWorktree()
  const activeRepo = useRepoById(activeWorktree?.repoId ?? null)
  const settings = useAppStore((s) => s.settings)
  const worktreePath = activeWorktree?.path ?? null

  const activeWorkspaceScope = parseWorkspaceKey(activeWorktreeId ?? '')
  const isFolderWorkspace = activeWorkspaceScope?.type === 'folder'
  const isFolder = isFolderWorkspace || (activeRepo ? isFolderRepo(activeRepo) : false)

  const repoSettings = useMemo(
    () => getRepoOwnerRoutedSettings(settings, activeRepo),
    [settings, activeRepo]
  )

  const commitsState = useWorkspaceTimelineCommits({
    worktreeId: activeWorktreeId,
    worktreePath,
    repoSettings,
    isGitWorktree: !isFolder,
    createdAt: activeWorktree?.createdAt
  })

  const persistedEntries = useWorkspaceTimelineStore((s) =>
    activeWorktreeId
      ? (s.entriesByWorktreeId[activeWorktreeId] ?? EMPTY_PERSISTED_ENTRIES)
      : EMPTY_PERSISTED_ENTRIES
  )
  const commitEntries =
    commitsState.status === 'ready' ? commitsState.entries : EMPTY_COMMIT_ENTRIES

  const entries = useMemo(
    () => mergeWorkspaceTimelineEntries(persistedEntries, commitEntries),
    [persistedEntries, commitEntries]
  )

  const openCommit = useOpenWorkspaceTimelineCommit({
    worktreeId: activeWorktreeId,
    worktreePath,
    repoSettings
  })
  const openFile = useOpenWorkspaceTimelineFile({ worktreeId: activeWorktreeId, worktreePath })

  if (!activeWorktreeId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        {translate(
          'auto.components.right.sidebar.workspace.timeline.WorkspaceTimelinePanel.cba5b45cf6',
          'Select a workspace to see its timeline.'
        )}
      </div>
    )
  }

  if (entries.length === 0 && commitsState.status !== 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
        <History className="size-5" aria-hidden="true" />
        <span>
          {translate(
            'auto.components.right.sidebar.workspace.timeline.WorkspaceTimelinePanel.ddb788cfb5',
            'No activity yet. Prompts, agent progress and commits will show up here.'
          )}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-sleek">
      {commitsState.status === 'error' && (
        <div className="px-3 py-1.5 text-[11px] text-destructive">{commitsState.message}</div>
      )}
      {entries.map((entry) => (
        <WorkspaceTimelineRow
          key={entry.id}
          entry={entry}
          onOpenCommit={openCommit}
          onOpenFile={openFile}
        />
      ))}
    </div>
  )
}
