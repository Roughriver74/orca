import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { WorkspaceCheckState } from '../../../../shared/workspace-check-types'
import { fetchWorkspaceCheckState } from './workspace-check-rpc'

/** Reads a worktree's check state from the store; `undefined` means it has not been
 *  fetched yet (vs. `null`, meaning no run has happened / no command is configured).
 *  Every WorktreeCard stays mounted (not virtualized), so the fetch-once-on-mount here
 *  is the only way a card learns about a check state from before it mounted.
 *  Why one selector: this hook mounts on every sidebar row (hundreds at capture scale),
 *  so a second `useAppStore` call here would double this feature's listener cost across
 *  the whole sidebar for no reactivity benefit — state and "has an entry" are read together. */
export function useWorkspaceCheckState(worktreeId: string): WorkspaceCheckState | null | undefined {
  // Why optional-chained: hand-rolled `vi.mock('@/store', ...)` fixtures across the sidebar
  // test suite predate this slice and supply a partial state object; a direct index would
  // throw for every one of them instead of just reporting "not fetched" like a real cold store.
  const [state, hasEntry] = useAppStore(
    useShallow((app) => [
      app.workspaceCheckStateByWorktreeId?.[worktreeId] ?? null,
      Boolean(app.workspaceCheckStateByWorktreeId) && worktreeId in app.workspaceCheckStateByWorktreeId
    ] as const)
  )
  const requestedRef = useRef(false)

  useEffect(() => {
    if (hasEntry || requestedRef.current) {
      return
    }
    requestedRef.current = true
    void fetchWorkspaceCheckState(worktreeId)
      .then((fetched) => {
        useAppStore.getState().setWorkspaceCheckState(worktreeId, fetched)
      })
      .catch(() => {
        // Why: no command configured or an unresolvable target both throw; either way
        // there is nothing to show, so leave the entry unset and let it stay hidden.
      })
  }, [hasEntry, worktreeId])

  return hasEntry ? state : undefined
}
