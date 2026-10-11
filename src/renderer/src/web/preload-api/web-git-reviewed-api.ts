import { toRuntimeWorktreeSelector } from '../../runtime/runtime-worktree-selector'
import { callRuntimeResult } from './web-runtime-calls'
import { resolveRuntimeWorktreeByPath } from './web-runtime-worktree-catalog'
import type { PreloadApi } from '../../../../preload/api-types'

/** Split out of `web-git-api.ts` to stay under the file's line budget; spread into `createGitApi()`. */
export const webGitReviewedApi: Pick<
  NonNullable<Partial<PreloadApi>['git']>,
  'reviewedMark' | 'reviewedChanges'
> = {
  reviewedMark: async ({ worktreePath }) => {
    const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
    return callRuntimeResult('git.reviewedMark', {
      worktree: toRuntimeWorktreeSelector(worktree.id)
    })
  },
  reviewedChanges: async ({ worktreePath }) => {
    const worktree = await resolveRuntimeWorktreeByPath(worktreePath)
    return callRuntimeResult('git.reviewedChanges', {
      worktree: toRuntimeWorktreeSelector(worktree.id)
    })
  }
}
