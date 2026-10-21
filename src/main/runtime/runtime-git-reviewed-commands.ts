import type {
  GitReviewedChangesResult,
  GitReviewedMarkResult
} from '../../shared/git-reviewed-types'
import {
  getReviewedChanges,
  localReviewedExec,
  markWorkspaceReviewed,
  reviewedScopeKey
} from '../git/status'
import type { ReviewedGitExec } from '../git/source-control/reviewed-snapshot'
import { SshHostNotServedError } from '../providers/ssh-host-not-served-error'
import {
  localGitOptionsForTarget,
  runtimeGitRouteForTarget,
  type RuntimeGitCommandHost
} from './runtime-git-command-target'

export class RuntimeGitReviewedCommands {
  constructor(private readonly host: RuntimeGitCommandHost) {}

  async markRuntimeGitReviewed(worktreeSelector: string): Promise<GitReviewedMarkResult> {
    const { exec, scopeKey } = await this.resolve(worktreeSelector)
    return markWorkspaceReviewed(exec, scopeKey)
  }

  async getRuntimeGitReviewedChanges(worktreeSelector: string): Promise<GitReviewedChangesResult> {
    const { exec, scopeKey } = await this.resolve(worktreeSelector)
    return getReviewedChanges(exec, scopeKey)
  }

  private async resolve(
    worktreeSelector: string
  ): Promise<{ exec: ReviewedGitExec; scopeKey: string }> {
    const target = await this.host.resolveRuntimeGitTarget(worktreeSelector)
    const route = runtimeGitRouteForTarget(target)
    if (route.kind === 'local') {
      return {
        exec: localReviewedExec(target.worktree.path, localGitOptionsForTarget(target)),
        scopeKey: reviewedScopeKey(null, target.worktree.path)
      }
    }
    throw new SshHostNotServedError(route.connectionId)
  }
}
