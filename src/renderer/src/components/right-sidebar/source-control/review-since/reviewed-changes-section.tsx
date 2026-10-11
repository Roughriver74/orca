import React from 'react'
import { CheckCheck, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type {
  GitBranchChangeEntry,
  GitCommitCompareSummary
} from '../../../../../../shared/git-diff-compare-types'
import { ActionButton } from '../listing/action-button'
import { BranchEntryRow } from '../listing/branch-entry-row'
import { SectionHeader } from '../listing/section-header'
import { VirtualizedList } from '../../../virtualized-list'
import type { SourceControlRowOpenEvent } from '../listing/split-open'
import type { ReviewedChangesState } from './use-reviewed-changes'

/** The "Since review" section: a "Mark as reviewed" snapshot action plus the files changed since the last mark, opened through the same commit-diff viewer branch/history compares already use. */
export function SourceControlReviewedChangesSection({
  state,
  isCollapsed,
  onToggle,
  onMarkReviewed,
  onRefresh,
  isMarkingReviewed,
  currentWorktreeId,
  worktreePath,
  fileListScrollElement,
  revealInExplorer,
  activeConnectionId,
  openReviewedDiff,
  openReviewedAllDiffs,
  diffCommentCountByPath
}: {
  state: ReviewedChangesState
  isCollapsed: boolean
  onToggle: () => void
  onMarkReviewed: () => void
  onRefresh: () => void
  isMarkingReviewed: boolean
  currentWorktreeId: string
  worktreePath: string
  fileListScrollElement: HTMLDivElement | null
  revealInExplorer: (worktreeId: string, absolutePath: string) => void
  activeConnectionId: string | null
  openReviewedDiff: (
    entry: GitBranchChangeEntry,
    summary: GitCommitCompareSummary,
    event?: SourceControlRowOpenEvent
  ) => void
  openReviewedAllDiffs: (summary: GitCommitCompareSummary, entries: GitBranchChangeEntry[]) => void
  diffCommentCountByPath: Map<string, number>
}): React.JSX.Element {
  const result = state.status === 'ready' ? state.result : null
  const summary = result?.reviewed ? result.compare.summary : null
  const entries = result?.reviewed ? result.compare.entries : []
  const isLoading = state.status === 'loading'

  return (
    <div>
      <SectionHeader
        label={translate('sourceControl.reviewedChanges.sectionLabel', 'Since review')}
        count={entries.length}
        countTitle={translate(
          'sourceControl.reviewedChanges.countTitle',
          'Files changed since this workspace was last marked reviewed'
        )}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        actions={
          <div className="flex items-center gap-1">
            {summary && (
              <ActionButton
                icon={RefreshCw}
                title={translate('sourceControl.reviewedChanges.refresh', 'Refresh')}
                disabled={isLoading}
                onClick={(event) => {
                  event.stopPropagation()
                  onRefresh()
                }}
              />
            )}
            <ActionButton
              icon={CheckCheck}
              title={translate('sourceControl.reviewedChanges.markReviewed', 'Mark as reviewed')}
              disabled={isMarkingReviewed}
              onClick={(event) => {
                event.stopPropagation()
                onMarkReviewed()
              }}
            />
          </div>
        }
      />
      {!isCollapsed && (
        <>
          {!summary && !isLoading && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {translate(
                'sourceControl.reviewedChanges.emptyState',
                'Mark this workspace as reviewed, then come back later to see only what changed since.'
              )}
            </p>
          )}
          {state.status === 'error' && (
            <p className="px-3 pb-2 text-xs text-destructive">{state.error}</p>
          )}
          {summary?.status === 'error' && summary.errorMessage && (
            <p className="px-3 pb-2 text-xs text-destructive">{summary.errorMessage}</p>
          )}
          {summary?.status === 'ready' && entries.length === 0 && (
            <p className="px-3 pb-2 text-xs text-muted-foreground">
              {translate(
                'sourceControl.reviewedChanges.noChanges',
                'No changes since you marked this workspace reviewed.'
              )}
            </p>
          )}
          {summary?.status === 'ready' && entries.length > 0 && (
            <>
              <div className="px-3 pb-1">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => openReviewedAllDiffs(summary, entries)}
                >
                  {translate('sourceControl.reviewedChanges.openAll', 'Open all diffs')}
                </button>
              </div>
              <VirtualizedList
                rows={entries}
                scrollElement={fileListScrollElement}
                getRowKey={(entry) => `reviewed:${entry.path}`}
                renderRow={(entry) => (
                  <BranchEntryRow
                    key={`reviewed:${entry.path}`}
                    entry={entry}
                    currentWorktreeId={currentWorktreeId}
                    worktreePath={worktreePath}
                    onRevealInExplorer={revealInExplorer}
                    connectionId={activeConnectionId}
                    onOpen={(event) => openReviewedDiff(entry, summary, event)}
                    commentCount={diffCommentCountByPath.get(entry.path) ?? 0}
                  />
                )}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
