import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { getRelativePathInsideRoot, joinPath, normalizeRelativePath } from '@/lib/path'
import { isRuntimePathAbsolute } from '../../../../../shared/cross-platform-path'
import type { WorkspaceTimelineFileEntry } from './workspace-timeline-types'

/** Resolves a hook-reported tool-input path (absolute or worktree-relative, and either may
 *  arrive depending on the agent CLI) into the absolute/relative pair `openFile` needs. */
export function resolveWorkspaceTimelineFilePaths(
  worktreePath: string,
  rawPath: string
): { filePath: string; relativePath: string } {
  if (isRuntimePathAbsolute(rawPath)) {
    const relativePath =
      getRelativePathInsideRoot(rawPath, worktreePath) ??
      normalizeRelativePath(rawPath, worktreePath)
    return { filePath: rawPath, relativePath }
  }
  const relativePath = normalizeRelativePath(rawPath, worktreePath)
  return { filePath: joinPath(worktreePath, relativePath), relativePath }
}

/** Opens the file a timeline entry reports as touched, in the active worktree's editor. */
export function useOpenWorkspaceTimelineFile({
  worktreeId,
  worktreePath
}: {
  worktreeId: string | null
  worktreePath: string | null
}): (entry: WorkspaceTimelineFileEntry) => void {
  const openFile = useAppStore((s) => s.openFile)

  return useCallback(
    (entry: WorkspaceTimelineFileEntry) => {
      if (!worktreeId || !worktreePath) {
        return
      }
      const { filePath, relativePath } = resolveWorkspaceTimelineFilePaths(worktreePath, entry.path)
      openFile({
        filePath,
        relativePath,
        worktreeId,
        language: detectLanguage(relativePath),
        mode: 'edit'
      })
    },
    [openFile, worktreeId, worktreePath]
  )
}
