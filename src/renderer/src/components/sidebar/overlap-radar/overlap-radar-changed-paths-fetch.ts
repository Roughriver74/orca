import { getRuntimeGitBranchCompare } from '@/runtime/runtime-git-diff-client'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-status-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

/**
 * A worktree's overlap-radar changed-file set: everything committed since the merge-base
 * with `baseRef`, plus the current uncommitted working-tree state. Reuses the exact two
 * endpoints the source-control panel already calls for the active worktree (git:status,
 * git:branchCompare) so overlap radar adds no new git subprocess shape, and routes through
 * the same local/SSH/runtime dispatch those endpoints already have.
 */
export async function fetchOverlapRadarChangedPaths(
  context: RuntimeGitContext,
  baseRef: string | null
): Promise<string[]> {
  const [status, branchCompare] = await Promise.all([
    getRuntimeGitStatus(context, { admissionTier: 'background' }),
    baseRef
      ? getRuntimeGitBranchCompare(context, baseRef, 'background').catch(() => null)
      : Promise.resolve(null)
  ])
  const paths = new Set<string>()
  for (const entry of status.entries) {
    paths.add(entry.path)
  }
  if (branchCompare && branchCompare.summary.status === 'ready') {
    for (const entry of branchCompare.entries) {
      paths.add(entry.path)
    }
  }
  return [...paths]
}
