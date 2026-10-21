import { ipcMain } from 'electron'
import type {
  GitReviewedChangesResult,
  GitReviewedMarkResult
} from '../../../shared/git-reviewed-types'
import {
  getReviewedChanges,
  localReviewedExec,
  markWorkspaceReviewed,
  reviewedScopeKey
} from '../../git/status'
import type { ReviewedGitExec } from '../../git/source-control/reviewed-snapshot'
import { SshHostNotServedError } from '../../providers/ssh-host-not-served-error'
import { resolveRegisteredWorktreePath } from '../registered-worktree-roots-cache'
import { getLocalGitOptionsForRegisteredWorktree } from '../local-worktree-runtime-options'
import type { FilesystemHandlerContext } from './filesystem-handler-context'

type ReviewedArgs = { worktreePath: string; connectionId?: string }

/** The scope key is hashed from the raw registered path, not the locally-resolved one, so it stays identical across local and SSH routing for the same workspace. */
async function resolveReviewedExec(
  context: FilesystemHandlerContext,
  args: ReviewedArgs
): Promise<{ exec: ReviewedGitExec; scopeKey: string }> {
  if (args.connectionId) {
    throw new SshHostNotServedError(args.connectionId)
  }
  const worktreePath = await resolveRegisteredWorktreePath(args.worktreePath, context.store)
  const gitOptions = getLocalGitOptionsForRegisteredWorktree(
    context.store,
    args.worktreePath,
    worktreePath
  )
  return {
    exec: localReviewedExec(worktreePath, gitOptions),
    scopeKey: reviewedScopeKey(null, args.worktreePath)
  }
}

export function registerFilesystemGitReviewedHandlers(context: FilesystemHandlerContext): void {
  ipcMain.handle(
    'git:reviewedMark',
    async (_event, args: ReviewedArgs): Promise<GitReviewedMarkResult> => {
      const { exec, scopeKey } = await resolveReviewedExec(context, args)
      return markWorkspaceReviewed(exec, scopeKey)
    }
  )

  ipcMain.handle(
    'git:reviewedChanges',
    async (_event, args: ReviewedArgs): Promise<GitReviewedChangesResult> => {
      const { exec, scopeKey } = await resolveReviewedExec(context, args)
      return getReviewedChanges(exec, scopeKey)
    }
  )
}
