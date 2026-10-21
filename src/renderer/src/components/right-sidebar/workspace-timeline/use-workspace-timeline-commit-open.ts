import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitCommitCompare } from '@/runtime/runtime-git-diff-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { translate } from '@/i18n/i18n'
import type { WorkspaceTimelineCommitEntry } from './workspace-timeline-types'

const COMMIT_DIFF_FAILED_KEY = 'auto.components.right.sidebar.SourceControl.8a5ba6a988'
const COMMIT_DIFF_FAILED_FALLBACK = 'Failed to load commit diff'

/** Opens the combined diff for a timeline commit entry, reusing the same compare fetch and
 *  store action Source Control's history panel uses for "open commit". */
export function useOpenWorkspaceTimelineCommit({
  worktreeId,
  worktreePath,
  repoSettings
}: {
  worktreeId: string | null
  worktreePath: string | null
  repoSettings: RuntimeGitContext['target']
}): (entry: WorkspaceTimelineCommitEntry) => void {
  const openCommitAllDiffs = useAppStore((s) => s.openCommitAllDiffs)

  return useCallback(
    (entry: WorkspaceTimelineCommitEntry) => {
      if (!worktreeId || !worktreePath) {
        return
      }
      const connectionId = getConnectionId(worktreeId) ?? undefined
      void getRuntimeGitCommitCompare(
        { target: repoSettings, worktreeId, worktreePath, connectionId },
        entry.commitId
      )
        .then((result) => {
          if (result.summary.status !== 'ready') {
            throw new Error(
              result.summary.errorMessage ??
                translate(COMMIT_DIFF_FAILED_KEY, COMMIT_DIFF_FAILED_FALLBACK)
            )
          }
          openCommitAllDiffs(
            worktreeId,
            worktreePath,
            result.summary,
            result.entries,
            entry.subject,
            entry.message
          )
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : translate(COMMIT_DIFF_FAILED_KEY, COMMIT_DIFF_FAILED_FALLBACK)
          )
        })
    },
    [openCommitAllDiffs, repoSettings, worktreeId, worktreePath]
  )
}
