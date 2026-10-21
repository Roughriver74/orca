import { getExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/runtime-client-target'
import { useAppStore } from '@/store'
import type { WorkspaceCheckState } from '../../../../shared/workspace-check-types'

/** Resolves the runtime target that owns `worktreeId`'s execution host, the same way
 *  other worktree-scoped RPCs (e.g. terminal.stop) pick their target. */
function resolveWorkspaceCheckTarget(worktreeId: string) {
  const state = useAppStore.getState()
  const executionHostId = getExecutionHostIdForWorktree(state, worktreeId)
  return ipcOrRuntimeTargetForHostId(executionHostId) ?? { kind: 'local' as const }
}

export async function fetchWorkspaceCheckState(
  worktreeId: string
): Promise<WorkspaceCheckState | null> {
  const target = resolveWorkspaceCheckTarget(worktreeId)
  const result = await callRuntimeRpc<{ state: WorkspaceCheckState | null }>(
    target,
    'workspaceCheck.get',
    { worktreeId },
    { timeoutMs: 15_000 }
  )
  return result.state
}

export async function runWorkspaceCheck(worktreeId: string): Promise<WorkspaceCheckState> {
  const target = resolveWorkspaceCheckTarget(worktreeId)
  const result = await callRuntimeRpc<{ state: WorkspaceCheckState }>(
    target,
    'workspaceCheck.run',
    { worktreeId },
    { timeoutMs: 15_000 }
  )
  return result.state
}
