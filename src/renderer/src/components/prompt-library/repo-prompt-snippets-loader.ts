import { useEffect, useState } from 'react'
import { parseRepoPromptSnippetFiles } from '../../../../shared/repo-prompt-snippets'
import type { PromptSnippet } from '../../../../shared/prompt-snippet-types'
import { resolveRuntimePath } from '../../../../shared/cross-platform-path'

const REPO_PROMPTS_SUBDIR = '.orca/prompts'

type RepoPromptSnippetsCacheEntry = {
  worktreePath: string
  connectionId: string | null | undefined
  snippets: PromptSnippet[]
}

// Why module scope: the insert modal and every chip row across panes share one cache per
// worktree path, refreshed on-demand (modal open / chip row mount) rather than fs-watched.
const cacheByWorktreePath = new Map<string, RepoPromptSnippetsCacheEntry>()

/** Snippets currently cached for `worktreePath`, or an empty array before the first load. */
export function getCachedRepoPromptSnippets(worktreePath: string): PromptSnippet[] {
  return cacheByWorktreePath.get(worktreePath)?.snippets ?? []
}

/** Re-reads `<worktreePath>/.orca/prompts/*.md` (SSH-aware via `connectionId`) and updates
 *  the cache. A missing directory — the common case — resolves to an empty list silently;
 *  only genuinely unexpected errors are swallowed too, since this is a best-effort refresh
 *  triggered by UI mounts, not a user action with its own error surface. */
export async function refreshRepoPromptSnippets(
  worktreePath: string,
  connectionId: string | null | undefined
): Promise<PromptSnippet[]> {
  const dirPath = resolveRuntimePath(worktreePath, REPO_PROMPTS_SUBDIR)
  let entries: { name: string; isDirectory: boolean }[] = []
  try {
    entries = await window.api.fs.readDir({ dirPath, connectionId: connectionId ?? undefined })
  } catch {
    cacheByWorktreePath.set(worktreePath, { worktreePath, connectionId, snippets: [] })
    return []
  }
  const mdFiles = entries.filter((entry) => !entry.isDirectory && entry.name.endsWith('.md'))
  const files = await Promise.all(
    mdFiles.map(async (entry) => {
      try {
        const result = await window.api.fs.readFile({
          filePath: resolveRuntimePath(dirPath, entry.name),
          connectionId: connectionId ?? undefined
        })
        return { name: entry.name, content: result.isBinary ? '' : result.content }
      } catch {
        return { name: entry.name, content: '' }
      }
    })
  )
  const snippets = parseRepoPromptSnippetFiles(files.sort((a, b) => a.name.localeCompare(b.name)))
  cacheByWorktreePath.set(worktreePath, { worktreePath, connectionId, snippets })
  return snippets
}

const EMPTY_REPO_PROMPT_SNIPPETS: PromptSnippet[] = []

/** Repo prompt snippets for `worktreePath`, refreshed on mount and whenever the worktree
 *  (or its SSH connection) changes — no fs watcher, matching the insert modal's refresh
 *  policy. Starts from whatever is already cached so a remount does not flash empty. */
export function useRepoPromptSnippets(
  worktreePath: string | null,
  connectionId: string | null | undefined
): PromptSnippet[] {
  const [snippets, setSnippets] = useState<PromptSnippet[]>(() =>
    worktreePath ? getCachedRepoPromptSnippets(worktreePath) : EMPTY_REPO_PROMPT_SNIPPETS
  )
  useEffect(() => {
    if (!worktreePath) {
      setSnippets(EMPTY_REPO_PROMPT_SNIPPETS)
      return
    }
    setSnippets(getCachedRepoPromptSnippets(worktreePath))
    let cancelled = false
    void refreshRepoPromptSnippets(worktreePath, connectionId).then((loaded) => {
      if (!cancelled) {
        setSnippets(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [worktreePath, connectionId])
  return snippets
}
