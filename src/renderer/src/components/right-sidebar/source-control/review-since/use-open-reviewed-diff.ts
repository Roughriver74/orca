import { useCallback } from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type {
  GitBranchChangeEntry,
  GitCommitCompareSummary
} from '../../../../../../shared/git-diff-compare-types'
import {
  shouldOpenSourceControlRowAsPreview,
  type SourceControlRowOpenEvent
} from '../listing/split-open'

/**
 * Opens "since review" diffs through the existing commit-diff editor tab (`openCommitDiff` /
 * `openCommitAllDiffs`): the reviewed summary's `commitOid`/`parentOid` are explicit oids the
 * diff loader reads directly, so this needs no parallel fetch path or tab kind.
 */
export function useOpenReviewedDiff({
  activeWorktreeId,
  worktreePath,
  resolveSplitTargetGroupId
}: {
  activeWorktreeId: string | null
  worktreePath: string | null
  resolveSplitTargetGroupId: (event?: SourceControlRowOpenEvent) => string | undefined
}): {
  openReviewedDiff: (
    entry: GitBranchChangeEntry,
    summary: GitCommitCompareSummary,
    event?: SourceControlRowOpenEvent
  ) => void
  openReviewedAllDiffs: (summary: GitCommitCompareSummary, entries: GitBranchChangeEntry[]) => void
} {
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)
  const openCommitAllDiffs = useAppStore((s) => s.openCommitAllDiffs)

  const openReviewedDiff = useCallback(
    (
      entry: GitBranchChangeEntry,
      summary: GitCommitCompareSummary,
      event?: SourceControlRowOpenEvent
    ) => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      const targetGroupId = resolveSplitTargetGroupId(event)
      openCommitDiff(activeWorktreeId, worktreePath, entry, summary, detectLanguage(entry.path), {
        targetGroupId,
        preview: shouldOpenSourceControlRowAsPreview(event, targetGroupId)
      })
    },
    [activeWorktreeId, openCommitDiff, resolveSplitTargetGroupId, worktreePath]
  )

  const openReviewedAllDiffs = useCallback(
    (summary: GitCommitCompareSummary, entries: GitBranchChangeEntry[]) => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      openCommitAllDiffs(
        activeWorktreeId,
        worktreePath,
        summary,
        entries,
        translate('sourceControl.reviewedChanges.combinedDiffSubject', 'Changes since review')
      )
    },
    [activeWorktreeId, openCommitAllDiffs, worktreePath]
  )

  return { openReviewedDiff, openReviewedAllDiffs }
}
