import { useEffect } from 'react'
import { useAppStore } from '@/store'

/** Mirrors the local runtime's workspace check results into the store; remote environments
 *  arrive through the runtime client-event bridge instead. */
export function useWorkspaceCheckPushSync(): void {
  useEffect(
    () =>
      window.api.ui.onWorkspaceCheckChanged(({ worktreeId, state }) => {
        useAppStore.getState().setWorkspaceCheckState(worktreeId, state)
      }),
    []
  )
}
