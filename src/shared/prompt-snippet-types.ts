/** A user-defined (or starter) prompt-library snippet. `body` may reference
 *  `{branch}`, `{worktree}`, `{repo}`, `{file}`, `{selection}`, `{issue}`, and
 *  `{clipboard}` — see `prompt-snippet-variables.ts` for expansion. */
export type PromptSnippet = {
  id: string
  name: string
  body: string
  /** Lower sorts first; ties break by `id` for a stable order. */
  sortOrder: number
}
