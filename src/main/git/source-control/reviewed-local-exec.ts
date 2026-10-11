import type { GitRuntimeOptions } from '../git-runtime-options'
import { gitOptionsForWorktree } from '../git-runtime-options'
import { gitExecFileAsync } from '../runner'
import type { ReviewedGitExec } from './reviewed-snapshot'

/** Builds a `ReviewedGitExec` that runs Git locally against `worktreePath`, matching every other local git/source-control reader. */
export function localReviewedExec(
  worktreePath: string,
  options: GitRuntimeOptions = {}
): ReviewedGitExec {
  return (args: string[]) => gitExecFileAsync(args, gitOptionsForWorktree(worktreePath, options))
}
