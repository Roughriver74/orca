// ─── Resolves a worktreeId to where its "Check command" must run ────────────
import type { Store } from '../persistence'
import type { Repo } from '../../shared/repo-types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree/id'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import type { WorkspaceCheckExecutionTarget } from './workspace-check-command-runner'

export type WorkspaceCheckTargetResult =
  | { ok: true; cwd: string; repo: Repo }
  | { ok: false; error: string }

/**
 * Known limitation: an ad-hoc FolderWorkspace session's synthetic worktree id never matches a
 * Repo id, so this resolves to `ok: false` for it rather than crashing — the engine treats that
 * as "no check configured" and silently skips the workspace.
 */
export function resolveWorkspaceCheckTarget(
  store: Pick<Store, 'getRepo'>,
  worktreeId: string
): WorkspaceCheckTargetResult {
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  if (!parsed) {
    return { ok: false, error: `Malformed worktree id: ${worktreeId}` }
  }
  const repo = store.getRepo(parsed.repoId)
  if (!repo) {
    return { ok: false, error: `No repo found for worktree ${worktreeId}` }
  }
  return { ok: true, cwd: parsed.worktreePath, repo }
}

export function resolveWorkspaceCheckExecutionTarget(
  repo: Repo,
  cwd: string
): { ok: true; target: WorkspaceCheckExecutionTarget } | { ok: false; error: string } {
  const hostId = getRepoExecutionHostId(repo)
  const host = parseExecutionHostId(hostId)
  if (!host || host.kind === 'local') {
    return { ok: true, target: { type: 'local', cwd } }
  }
  if (host.kind === 'ssh') {
    return { ok: true, target: { type: 'ssh', cwd, connectionId: host.targetId } }
  }
  return { ok: false, error: 'Check command execution on this host type is not supported yet.' }
}
