import { createHash } from 'node:crypto'
import type {
  GitReviewedChangesResult,
  GitReviewedMarkResult
} from '../../../shared/git-reviewed-types'
import { gitChangeListArgs, parseGitChangeList } from '../../../shared/git-change-list'

// The canonical empty tree — same oid in every Git repository.
const EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/**
 * Runs one Git invocation and resolves its stdout/stderr. Matches both the local
 * `gitExecFileAsync` signature and `SshGitProvider.exec`, so the algorithm below runs unmodified
 * against a local worktree or an SSH-routed one — no new wire protocol needed for SSH support.
 */
export type ReviewedGitExec = (args: string[]) => Promise<{ stdout: string; stderr: string }>

/**
 * Ref names must be pathspec-safe; scope keys carry raw filesystem paths and SSH connection ids,
 * so the ref suffix is a content hash rather than the key itself. The ref lives under a private
 * namespace (`refs/orca/reviewed/*`) so it survives `git gc` (it's reachable) without ever
 * appearing in `git branch`/`git tag`, and multiple workspaces backed by the same repo (several
 * worktrees of one clone) never collide because each workspace hashes its own scope key.
 */
export function reviewedRefName(scopeKey: string): string {
  return `refs/orca/reviewed/${createHash('sha256').update(scopeKey).digest('hex')}`
}

/** `connectionId` is `null` for local workspaces; combined with the worktree path this is unique per workspace, even across hosts. */
export function reviewedScopeKey(
  connectionId: string | null | undefined,
  worktreePath: string
): string {
  return `${connectionId ?? 'local'}\u0000${worktreePath}`
}

async function resolveOptionalOid(exec: ReviewedGitExec, revision: string): Promise<string | null> {
  try {
    const { stdout } = await exec(['rev-parse', '--verify', '--quiet', revision])
    const oid = stdout.trim()
    return oid || null
  } catch {
    return null
  }
}

/**
 * A commit oid for the full current state — committed history plus staged and unstaged tracked
 * edits — built with `git stash create`. Git computes this through its own scratch index
 * internally, so unlike `git stash push` it never touches the caller's real index, HEAD, or the
 * stash list/ref: the resulting commit object is simply never referenced by anything until (and
 * unless) we `update-ref` it ourselves in `markWorkspaceReviewed`.
 */
async function snapshotWorktreeCommitOid(exec: ReviewedGitExec): Promise<string> {
  try {
    const { stdout } = await exec(['stash', 'create'])
    const oid = stdout.trim()
    if (oid) {
      return oid
    }
  } catch {
    // A conflicted merge/rebase can make `stash create` refuse; fall through to a HEAD snapshot.
  }
  const head = await resolveOptionalOid(exec, 'HEAD')
  if (head) {
    return head
  }
  // Unborn HEAD: a brand-new repo with no commits yet. Synthesize a commit over the empty tree so
  // compares still have something to diff against.
  const { stdout } = await exec(['commit-tree', EMPTY_TREE_OID, '-m', 'orca: empty snapshot'])
  return stdout.trim()
}

/** Snapshots the workspace's current state under its private ref. Never touches the user's index, HEAD, stash list, or working tree. */
export async function markWorkspaceReviewed(
  exec: ReviewedGitExec,
  scopeKey: string
): Promise<GitReviewedMarkResult> {
  const oid = await snapshotWorktreeCommitOid(exec)
  await exec(['update-ref', reviewedRefName(scopeKey), oid])
  const { stdout: reviewedAt } = await exec(['log', '-1', '--format=%cI', oid])
  return { reviewedOid: oid, reviewedAt: reviewedAt.trim() }
}

/** Deletes the workspace's reviewed-snapshot ref, if any. Safe to call when it was never set. */
export async function clearWorkspaceReviewed(
  exec: ReviewedGitExec,
  scopeKey: string
): Promise<void> {
  try {
    await exec(['update-ref', '-d', reviewedRefName(scopeKey)])
  } catch {
    // Already absent, or the repo is unreachable — nothing to clean up.
  }
}

const NOT_REVIEWED: GitReviewedChangesResult = { reviewed: false }

/** Files changed between the last `markWorkspaceReviewed` snapshot and the workspace's current state. */
export async function getReviewedChanges(
  exec: ReviewedGitExec,
  scopeKey: string
): Promise<GitReviewedChangesResult> {
  const reviewedOid = await resolveOptionalOid(exec, reviewedRefName(scopeKey))
  if (!reviewedOid) {
    return NOT_REVIEWED
  }
  try {
    const currentOid = await snapshotWorktreeCommitOid(exec)
    const { stdout } = await exec(gitChangeListArgs(reviewedOid, currentOid))
    const entries = parseGitChangeList(stdout)
    return {
      reviewed: true,
      compare: {
        summary: {
          commitOid: currentOid,
          parentOid: reviewedOid,
          compareRef: 'Working tree',
          baseRef: 'Reviewed snapshot',
          changedFiles: entries.length,
          status: 'ready'
        },
        entries
      }
    }
  } catch (error) {
    return {
      reviewed: true,
      compare: {
        summary: {
          commitOid: '',
          parentOid: reviewedOid,
          compareRef: 'Working tree',
          baseRef: 'Reviewed snapshot',
          changedFiles: 0,
          status: 'error',
          errorMessage:
            error instanceof Error ? error.message : 'Failed to compute changes since review'
        },
        entries: []
      }
    }
  }
}
