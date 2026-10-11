import { defineMethod } from '../core'
import { WorkspaceCheckWorktreeSelector } from '../../../../shared/rpc-contract/workspace-check-params'

export const WORKSPACE_CHECK_METHODS = [
  defineMethod({
    name: 'workspaceCheck.get',
    permission: 'workspace',
    params: WorkspaceCheckWorktreeSelector,
    handler: (params, { runtime }) => ({
      state: runtime.getWorkspaceCheckState(params.worktreeId)
    })
  }),
  defineMethod({
    name: 'workspaceCheck.run',
    permission: 'workspace',
    params: WorkspaceCheckWorktreeSelector,
    handler: async (params, { runtime }) => ({
      state: await runtime.runWorkspaceCheckNow(params.worktreeId)
    })
  })
]
