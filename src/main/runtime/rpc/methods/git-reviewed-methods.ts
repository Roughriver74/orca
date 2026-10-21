import { defineMethod } from '../core'
import { WorktreeSelector } from '../../../../shared/rpc-contract/git-params'

export const GIT_REVIEWED_METHODS = [
  defineMethod({
    name: 'git.reviewedMark',
    permission: 'workspace',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.markRuntimeGitReviewed(params.worktree)
  }),
  defineMethod({
    name: 'git.reviewedChanges',
    permission: 'workspace',
    params: WorktreeSelector,
    handler: async (params, { runtime }) => runtime.getRuntimeGitReviewedChanges(params.worktree)
  })
]
