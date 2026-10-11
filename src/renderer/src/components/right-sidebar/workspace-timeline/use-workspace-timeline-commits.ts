import { useEffect, useState } from 'react'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitHistory, type RuntimeGitContext } from '@/runtime/runtime-git-client'
import {
  WORKSPACE_TIMELINE_COMMIT_LIMIT,
  type WorkspaceTimelineCommitEntry
} from './workspace-timeline-types'

export type WorkspaceTimelineCommitsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; entries: WorkspaceTimelineCommitEntry[] }
  | { status: 'error'; message: string }

/** Loads a bounded `git log` page for the active worktree, filtered to commits made since
 *  the workspace was created when that timestamp is known. Re-fetches whenever the
 *  workspace, its repo-owner-routed settings, or its creation time changes. */
export function useWorkspaceTimelineCommits({
  worktreeId,
  worktreePath,
  repoSettings,
  isGitWorktree,
  createdAt
}: {
  worktreeId: string | null
  worktreePath: string | null
  repoSettings: RuntimeGitContext['settings']
  isGitWorktree: boolean
  createdAt?: number
}): WorkspaceTimelineCommitsState {
  const [state, setState] = useState<WorkspaceTimelineCommitsState>({ status: 'idle' })

  useEffect(() => {
    if (!worktreeId || !worktreePath || !isGitWorktree) {
      setState({ status: 'idle' })
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    const connectionId = getConnectionId(worktreeId) ?? undefined
    void getRuntimeGitHistory(
      { settings: repoSettings, worktreeId, worktreePath, connectionId },
      { limit: WORKSPACE_TIMELINE_COMMIT_LIMIT }
    )
      .then((result) => {
        if (cancelled) {
          return
        }
        const entries: WorkspaceTimelineCommitEntry[] = []
        for (const item of result.items) {
          if (typeof item.timestamp !== 'number') {
            continue
          }
          if (createdAt && item.timestamp < createdAt) {
            continue
          }
          entries.push({
            kind: 'commit',
            id: `commit:${worktreeId}:${item.id}`,
            worktreeId,
            timestamp: item.timestamp,
            commitId: item.id,
            displayId: item.displayId,
            subject: item.subject,
            message: item.message,
            author: item.author
          })
        }
        setState({ status: 'ready', entries })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load commits'
        })
      })
    return () => {
      cancelled = true
    }
  }, [worktreeId, worktreePath, isGitWorktree, repoSettings, createdAt])

  return state
}
