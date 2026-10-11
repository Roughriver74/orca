import { useCallback } from 'react'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'

/** Switches to the owning worktree (if needed) and opens an overlap-radar file for review. */
export function useOpenOverlapRadarFile(): (args: {
  worktreeId: string
  worktreePath: string
  path: string
}) => void {
  const openFile = useAppStore((s) => s.openFile)
  return useCallback(
    ({ worktreeId, worktreePath, path }) => {
      activateAndRevealWorkspace(worktreeId)
      openFile({
        filePath: joinPath(worktreePath, path),
        relativePath: path,
        worktreeId,
        mode: 'edit',
        language: detectLanguage(path)
      })
    },
    [openFile]
  )
}
