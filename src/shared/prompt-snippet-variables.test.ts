import { describe, expect, it } from 'vitest'
import {
  expandPromptSnippet,
  listReferencedPromptSnippetVariables
} from './prompt-snippet-variables'

describe('expandPromptSnippet', () => {
  it('substitutes every recognized variable with its context value', () => {
    const result = expandPromptSnippet('Explain {file} on {branch}', {
      file: 'src/App.tsx',
      branch: 'feat/prompt-library'
    })
    expect(result).toEqual({ text: 'Explain src/App.tsx on feat/prompt-library', missing: [] })
  })

  it('leaves unavailable variables empty and reports them once as missing', () => {
    const result = expandPromptSnippet('Ticket {issue}, dup {issue}, sel {selection}', {})
    expect(result.text).toBe('Ticket , dup , sel ')
    expect(result.missing).toEqual(['issue', 'selection'])
  })

  it('treats braces that are not one of the seven known names as literal text', () => {
    const result = expandPromptSnippet('Use {notAVariable} and {repo}', { repo: 'orca' })
    expect(result).toEqual({ text: 'Use {notAVariable} and orca', missing: [] })
  })

  it('reports a variable as missing when its context value is an empty string', () => {
    const result = expandPromptSnippet('{worktree}', { worktree: '' })
    expect(result).toEqual({ text: '', missing: ['worktree'] })
  })

  it('round-trips a body with every known variable', () => {
    const result = expandPromptSnippet(
      '{branch} {worktree} {repo} {file} {selection} {issue} {clipboard} {changedFiles} {checkCommand} {checkOutput} {lastAgentMessage} {overlap}',
      {
        branch: 'b',
        worktree: 'w',
        repo: 'r',
        file: 'f',
        selection: 's',
        issue: 'i',
        clipboard: 'c',
        changedFiles: 'cf',
        checkCommand: 'cc',
        checkOutput: 'co',
        lastAgentMessage: 'lam',
        overlap: 'ov'
      }
    )
    expect(result).toEqual({ text: 'b w r f s i c cf cc co lam ov', missing: [] })
  })
})

describe('listReferencedPromptSnippetVariables', () => {
  it('lists only recognized variables, deduplicated, in first-appearance order', () => {
    expect(
      listReferencedPromptSnippetVariables('{file} says {branch}, also {file} and {bogus}')
    ).toEqual(['file', 'branch'])
  })

  it('returns an empty list for a body with no variables', () => {
    expect(listReferencedPromptSnippetVariables('Review this change.')).toEqual([])
  })
})
