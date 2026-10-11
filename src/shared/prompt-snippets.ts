import type { PromptSnippet } from './prompt-snippet-types'

export const MAX_PROMPT_SNIPPETS = 100
export const MAX_PROMPT_SNIPPET_NAME_LENGTH = 100
export const MAX_PROMPT_SNIPPET_BODY_LENGTH = 8000

const STARTER_PROMPT_SNIPPETS: readonly Omit<PromptSnippet, 'sortOrder'>[] = [
  {
    id: 'starter-review-file',
    name: 'Review this file',
    body: 'Review {file} on branch {branch}. Focus on correctness, readability, and edge cases.'
  },
  {
    id: 'starter-write-tests',
    name: 'Write tests for {file}',
    body: 'Write unit tests for {file}, following the existing test conventions in this repo.'
  },
  {
    id: 'starter-excalidraw-diagram',
    name: 'Draw an Excalidraw diagram',
    body: 'Draw an Excalidraw diagram of {file} into docs/diagrams/<name>.excalidraw.'
  },
  {
    id: 'starter-explain-selection',
    name: 'Explain my selection',
    body: 'Explain this code from {file}:\n\n{selection}'
  }
]

export function getDefaultPromptSnippets(): PromptSnippet[] {
  return STARTER_PROMPT_SNIPPETS.map((snippet, index) => ({ ...snippet, sortOrder: index }))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Parses untrusted/persisted input into a sorted, capped, deduplicated snippet list.
 *  Malformed entries (missing name/body, wrong types) are dropped silently — the same
 *  tolerant-read posture as `normalizeTerminalQuickCommands`. */
export function normalizePromptSnippets(input: unknown): PromptSnippet[] {
  if (!Array.isArray(input)) {
    return []
  }
  const seenIds = new Set<string>()
  const snippets: PromptSnippet[] = []
  for (const raw of input) {
    if (snippets.length >= MAX_PROMPT_SNIPPETS) {
      break
    }
    if (!isPlainObject(raw)) {
      continue
    }
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    const name =
      typeof raw.name === 'string' ? raw.name.trim().slice(0, MAX_PROMPT_SNIPPET_NAME_LENGTH) : ''
    const body =
      typeof raw.body === 'string' ? raw.body.slice(0, MAX_PROMPT_SNIPPET_BODY_LENGTH) : ''
    const sortOrder =
      typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder)
        ? raw.sortOrder
        : snippets.length
    if (!id || !name || !body.trim() || seenIds.has(id)) {
      continue
    }
    seenIds.add(id)
    snippets.push({ id, name, body, sortOrder })
  }
  return snippets.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

export function isPromptSnippetComplete(snippet: Pick<PromptSnippet, 'name' | 'body'>): boolean {
  return snippet.name.trim().length > 0 && snippet.body.trim().length > 0
}

/** Reassigns `sortOrder` to match array order (0, 1, 2, ...) after a reorder/insert/delete. */
export function reindexPromptSnippets(snippets: readonly PromptSnippet[]): PromptSnippet[] {
  return snippets.map((snippet, index) => ({ ...snippet, sortOrder: index }))
}
