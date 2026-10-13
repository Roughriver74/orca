import { isPromptSnippetTrigger, type PromptSnippet, type PromptSnippetTrigger } from './prompt-snippet-types'

/** `repo:<file name>` — stable across reloads, distinguishable from settings-defined ids. */
export function repoPromptSnippetId(fileName: string): string {
  return `repo:${fileName}`
}

function stemFileName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

function parseWhenField(raw: string): PromptSnippetTrigger[] | undefined {
  const triggers: PromptSnippetTrigger[] = []
  const seen = new Set<string>()
  for (const token of raw.split(/[,\s]+/)) {
    const trimmed = token.trim()
    if (!trimmed || !isPromptSnippetTrigger(trimmed) || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    triggers.push(trimmed)
  }
  return triggers.length > 0 ? triggers : undefined
}

/** Splits optional `---`-delimited frontmatter (`name:`, `when:`) from the markdown body.
 *  Malformed or absent frontmatter leaves the whole file as the body — never throws. */
function splitFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content }
  }
  const afterOpening = content.slice(3)
  const closingIndex = afterOpening.indexOf('\n---')
  if (closingIndex === -1) {
    return { frontmatter: {}, body: content }
  }
  const rawFrontmatter = afterOpening.slice(0, closingIndex)
  // Why +4: skip past the `\n---` closer; a trailing newline on the same line is dropped too.
  const afterClosing = afterOpening.slice(closingIndex + 4)
  const body = afterClosing.startsWith('\n') ? afterClosing.slice(1) : afterClosing

  const frontmatter: Record<string, string> = {}
  for (const line of rawFrontmatter.split('\n')) {
    const colonIndex = line.indexOf(':')
    if (colonIndex <= 0) {
      continue
    }
    const key = line.slice(0, colonIndex).trim()
    const value = line.slice(colonIndex + 1).trim()
    if (key) {
      frontmatter[key] = value
    }
  }
  return { frontmatter, body }
}

/** Parses one `.orca/prompts/*.md` file into a PromptSnippet, or null for an empty body.
 *  `name` defaults to the file stem (without extension); `when` is comma/space separated
 *  trigger names, unknown ones dropped. Pure — no fs access. */
export function parseRepoPromptSnippetFile(
  fileName: string,
  content: string,
  sortOrder: number
): PromptSnippet | null {
  const { frontmatter, body } = splitFrontmatter(content)
  const trimmedBody = body.trim()
  if (!trimmedBody) {
    return null
  }
  const name = frontmatter.name?.trim() || stemFileName(fileName)
  const when = frontmatter.when ? parseWhenField(frontmatter.when) : undefined
  return {
    id: repoPromptSnippetId(fileName),
    name,
    body: trimmedBody,
    sortOrder,
    ...(when ? { when } : {})
  }
}

/** Parses every `.md` entry's content into snippets, in the given file order,
 *  dropping files with an empty body. */
export function parseRepoPromptSnippetFiles(
  files: readonly { name: string; content: string }[]
): PromptSnippet[] {
  const snippets: PromptSnippet[] = []
  for (const file of files) {
    const snippet = parseRepoPromptSnippetFile(file.name, file.content, snippets.length)
    if (snippet) {
      snippets.push(snippet)
    }
  }
  return snippets
}
