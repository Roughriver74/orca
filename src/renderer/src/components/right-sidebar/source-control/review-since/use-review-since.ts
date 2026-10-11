import type { RuntimeGitContext } from '@/runtime/runtime-git-client'
import type { SourceControlRowOpenEvent } from '../listing/split-open'
import { useOpenReviewedDiff } from './use-open-reviewed-diff'
import { useSourceControlReviewedChanges } from './use-reviewed-changes'

/** Single entry point for `use-panel-model.ts`: the "since review" fetch/mark state plus its diff-opening actions, so the shared composition hook only needs one extra call. */
export function useSourceControlReviewSince({
  activeRepoSettings,
  activeWorktreeId,
  worktreePath,
  isFolder,
  activeConnectionId,
  statusFingerprint,
  resolveSplitTargetGroupId
}: {
  activeRepoSettings: RuntimeGitContext['settings']
  activeWorktreeId: string | null
  worktreePath: string | null
  isFolder: boolean
  activeConnectionId: string | null
  statusFingerprint: string
  resolveSplitTargetGroupId: (event?: SourceControlRowOpenEvent) => string | undefined
}) {
  const reviewedChanges = useSourceControlReviewedChanges({
    activeRepoSettings,
    activeWorktreeId,
    worktreePath,
    isFolder,
    connectionId: activeConnectionId,
    statusFingerprint
  })
  const openers = useOpenReviewedDiff({ activeWorktreeId, worktreePath, resolveSplitTargetGroupId })
  return { ...reviewedChanges, ...openers }
}
