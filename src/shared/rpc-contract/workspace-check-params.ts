import { z } from 'zod'
import { requiredString } from './rpc-param-primitives'

export const WorkspaceCheckWorktreeSelector = z.object({
  worktreeId: requiredString('Missing worktree id')
})
