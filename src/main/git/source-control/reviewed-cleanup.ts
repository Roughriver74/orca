import { isFolderRepo } from '../../../shared/repo-kind'
import { getRepoIdFromWorktreeId } from '../../../shared/worktree/id'
import type { Store } from '../../persistence'
import { parseWorktreeId } from '../../ipc/worktree-logic'
import { clearWorkspaceReviewed, localReviewedExec, reviewedScopeKey } from '../status'

/**
 * Best-effort: deletes the workspace's `refs/orca/reviewed/*` snapshot so it doesn't outlive the
 * workspace. Non-git (folder) repos never had a ref to begin with. SSH-backed workspaces are
 * skipped outright — removal (notably `forgetLocal`) is the deliberate no-provider-dispatch escape
 * hatch for a dead/removed SSH target, so cleanup must never reach for a provider here, live or
 * not; their stray ref just waits for the repo's own `git gc` to reclaim it. A repo that's already
 * gone, or a cross-host id collision, is likewise never worth blocking or failing removal over.
 */
export function clearWorkspaceReviewedForRemoval(store: Store, worktreeId: string): void {
  void (async () => {
    let worktreePath: string
    try {
      ;({ worktreePath } = parseWorktreeId(worktreeId))
    } catch {
      return
    }
    const repo = store.getRepo(getRepoIdFromWorktreeId(worktreeId))
    if (!repo || isFolderRepo(repo) || repo.connectionId) {
      return
    }
    try {
      await clearWorkspaceReviewed(
        localReviewedExec(repo.path),
        reviewedScopeKey(null, worktreePath)
      )
    } catch {
      // Best effort — never block workspace removal on ref cleanup.
    }
  })()
}
