import { describe, expect, it } from 'vitest'
import {
  parseRepoPromptSnippetFile,
  parseRepoPromptSnippetFiles,
  repoPromptSnippetId
} from './repo-prompt-snippets'

describe('repoPromptSnippetId', () => {
  it('prefixes the file name with repo:', () => {
    expect(repoPromptSnippetId('fix-check.md')).toBe('repo:fix-check.md')
  })
})

describe('parseRepoPromptSnippetFile', () => {
  it('uses the file stem as the name when there is no frontmatter', () => {
    const snippet = parseRepoPromptSnippetFile('fix-check.md', 'Fix the check.', 0)
    expect(snippet).toEqual({
      id: 'repo:fix-check.md',
      name: 'fix-check',
      body: 'Fix the check.',
      sortOrder: 0
    })
  })

  it('reads name and when from frontmatter', () => {
    const content = ['---', 'name: Fix the failing check', 'when: checkFailed', '---', '', 'Fix {checkOutput}'].join(
      '\n'
    )
    const snippet = parseRepoPromptSnippetFile('a.md', content, 2)
    expect(snippet).toEqual({
      id: 'repo:a.md',
      name: 'Fix the failing check',
      body: 'Fix {checkOutput}',
      sortOrder: 2,
      when: ['checkFailed']
    })
  })

  it('parses a comma/space separated when list and drops unknown triggers', () => {
    const content = ['---', 'when: checkFailed, bogus overlap', '---', 'Body'].join('\n')
    const snippet = parseRepoPromptSnippetFile('b.md', content, 0)
    expect(snippet?.when).toEqual(['checkFailed', 'overlap'])
  })

  it('omits when entirely if every token is unrecognized', () => {
    const content = ['---', 'when: bogus, nonsense', '---', 'Body'].join('\n')
    const snippet = parseRepoPromptSnippetFile('c.md', content, 0)
    expect(snippet?.when).toBeUndefined()
  })

  it('returns null for an empty body', () => {
    expect(parseRepoPromptSnippetFile('empty.md', '   ', 0)).toBeNull()
    expect(parseRepoPromptSnippetFile('empty.md', '---\nname: x\n---\n', 0)).toBeNull()
  })

  it('treats a file without a closing --- as having no frontmatter', () => {
    const content = '---\nname: X\nStill the body, no closer.'
    const snippet = parseRepoPromptSnippetFile('d.md', content, 0)
    expect(snippet?.name).toBe('d')
    expect(snippet?.body).toBe(content.trim())
  })
})

describe('parseRepoPromptSnippetFiles', () => {
  it('parses every file in order, skipping empties', () => {
    const snippets = parseRepoPromptSnippetFiles([
      { name: 'a.md', content: 'First' },
      { name: 'b.md', content: '   ' },
      { name: 'c.md', content: 'Third' }
    ])
    expect(snippets.map((s) => s.id)).toEqual(['repo:a.md', 'repo:c.md'])
    expect(snippets.map((s) => s.sortOrder)).toEqual([0, 1])
  })
})
