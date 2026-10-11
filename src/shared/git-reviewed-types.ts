import type { GitCommitCompareResult } from './git-diff-compare-types'

export type GitReviewedMarkResult = {
  /** The commit this workspace's current state was snapshotted into. */
  reviewedOid: string
  /** ISO-8601 timestamp of the snapshot, surfaced in the UI as "reviewed at". */
  reviewedAt: string
}

/**
 * `reviewed: false` means "Mark as reviewed" has never run for this workspace — there is no
 * snapshot to diff against. `compare` reuses `GitCommitCompareResult` (`parentOid` = the reviewed
 * snapshot, `commitOid` = the workspace's current state) so the renderer can open per-file diffs
 * through the existing commit-diff viewer without a parallel fetch path.
 */
export type GitReviewedChangesResult =
  | { reviewed: false }
  | { reviewed: true; compare: GitCommitCompareResult }
