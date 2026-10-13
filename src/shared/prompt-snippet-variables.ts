export const PROMPT_SNIPPET_VARIABLE_NAMES = [
  'branch',
  'worktree',
  'repo',
  'file',
  'selection',
  'issue',
  'clipboard',
  'changedFiles',
  'checkCommand',
  'checkOutput',
  'lastAgentMessage',
  'overlap'
] as const

export type PromptSnippetVariableName = (typeof PROMPT_SNIPPET_VARIABLE_NAMES)[number]

/** Resolved value per variable; a missing/empty entry means "unavailable in this context". */
export type PromptSnippetVariableContext = Partial<Record<PromptSnippetVariableName, string>>

export type PromptSnippetExpansion = {
  text: string
  /** Recognized variables referenced by the body whose value was empty/unavailable. */
  missing: PromptSnippetVariableName[]
}

const PROMPT_SNIPPET_VARIABLE_FLAG: Record<string, true> = {
  branch: true,
  worktree: true,
  repo: true,
  file: true,
  selection: true,
  issue: true,
  clipboard: true,
  changedFiles: true,
  checkCommand: true,
  checkOutput: true,
  lastAgentMessage: true,
  overlap: true
}

function isPromptSnippetVariableName(value: string): value is PromptSnippetVariableName {
  return PROMPT_SNIPPET_VARIABLE_FLAG[value] === true
}

// Why: only the seven known names are variables — any other `{word}` (e.g. JSON-like
// snippet bodies) is literal text and must pass through untouched.
const VARIABLE_TOKEN_RE = /\{([a-zA-Z]+)\}/g

/** Substitutes `{variable}` tokens from `context`; unavailable ones become empty text
 *  and are reported in `missing` so the UI can flag them in a live preview. */
export function expandPromptSnippet(
  body: string,
  context: PromptSnippetVariableContext
): PromptSnippetExpansion {
  const missing: PromptSnippetVariableName[] = []
  const seenMissing = new Set<PromptSnippetVariableName>()
  const text = body.replace(VARIABLE_TOKEN_RE, (match, rawName: string) => {
    if (!isPromptSnippetVariableName(rawName)) {
      return match
    }
    const value = context[rawName]
    if (!value) {
      if (!seenMissing.has(rawName)) {
        seenMissing.add(rawName)
        missing.push(rawName)
      }
      return ''
    }
    return value
  })
  return { text, missing }
}

/** Every recognized variable the body references, in order of first appearance. */
export function listReferencedPromptSnippetVariables(body: string): PromptSnippetVariableName[] {
  const seen = new Set<PromptSnippetVariableName>()
  const names: PromptSnippetVariableName[] = []
  for (const match of body.matchAll(VARIABLE_TOKEN_RE)) {
    const rawName = match[1] ?? ''
    if (isPromptSnippetVariableName(rawName) && !seen.has(rawName)) {
      seen.add(rawName)
      names.push(rawName)
    }
  }
  return names
}
