/** A user-defined (or starter) prompt-library snippet. `body` may reference
 *  `{branch}`, `{worktree}`, `{repo}`, `{file}`, `{selection}`, `{issue}`,
 *  `{clipboard}`, `{changedFiles}`, `{checkCommand}`, `{checkOutput}`,
 *  `{lastAgentMessage}`, and `{overlap}` — see `prompt-snippet-variables.ts`
 *  for expansion. */
export type PromptSnippet = {
  id: string
  name: string
  body: string
  /** Lower sorts first; ties break by `id` for a stable order. */
  sortOrder: number
  /** When set, every listed trigger must hold for this snippet to be suggested
   *  as an agent-terminal chip. Absent/empty = never suggested as a chip
   *  (still available in the library/insert modal). */
  when?: PromptSnippetTrigger[]
}

/** Conditions a suggestion-chip row checks per pane before offering a snippet. */
export const PROMPT_SNIPPET_TRIGGERS = [
  'checkFailed',
  'overlap',
  'agentDone',
  'hasIssue',
  'hasChanges'
] as const

export type PromptSnippetTrigger = (typeof PROMPT_SNIPPET_TRIGGERS)[number]

const PROMPT_SNIPPET_TRIGGER_FLAG: Record<string, true> = {
  checkFailed: true,
  overlap: true,
  agentDone: true,
  hasIssue: true,
  hasChanges: true
}

export function isPromptSnippetTrigger(value: string): value is PromptSnippetTrigger {
  return PROMPT_SNIPPET_TRIGGER_FLAG[value] === true
}
