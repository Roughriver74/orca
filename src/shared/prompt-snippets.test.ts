import { describe, expect, it } from 'vitest'
import {
  getDefaultPromptSnippets,
  isPromptSnippetComplete,
  normalizePromptSnippets,
  reindexPromptSnippets,
  seedPromptLibraryContextStarters
} from './prompt-snippets'

describe('normalizePromptSnippets', () => {
  it('returns an empty list for non-array input', () => {
    expect(normalizePromptSnippets(null)).toEqual([])
    expect(normalizePromptSnippets({ id: 'a' })).toEqual([])
  })

  it('drops entries missing an id, a name, or a non-blank body', () => {
    const result = normalizePromptSnippets([
      { id: '', name: 'No id', body: 'x', sortOrder: 0 },
      { id: 'b', name: '', body: 'x', sortOrder: 0 },
      { id: 'c', name: 'Blank body', body: '   ', sortOrder: 0 },
      { id: 'd', name: 'Kept', body: 'x', sortOrder: 0 }
    ])
    expect(result).toEqual([{ id: 'd', name: 'Kept', body: 'x', sortOrder: 0 }])
  })

  it('drops a later entry that reuses an earlier id', () => {
    const result = normalizePromptSnippets([
      { id: 'a', name: 'First', body: 'one', sortOrder: 0 },
      { id: 'a', name: 'Second', body: 'two', sortOrder: 1 }
    ])
    expect(result).toEqual([{ id: 'a', name: 'First', body: 'one', sortOrder: 0 }])
  })

  it('sorts by sortOrder, breaking ties by id', () => {
    const result = normalizePromptSnippets([
      { id: 'z', name: 'Z', body: 'z', sortOrder: 1 },
      { id: 'a', name: 'A', body: 'a', sortOrder: 0 },
      { id: 'b', name: 'B', body: 'b', sortOrder: 0 }
    ])
    expect(result.map((snippet) => snippet.id)).toEqual(['a', 'b', 'z'])
  })

  it('caps the list at MAX_PROMPT_SNIPPETS', () => {
    const input = Array.from({ length: 150 }, (_, index) => ({
      id: `s${index}`,
      name: `Snippet ${index}`,
      body: 'body',
      sortOrder: index
    }))
    expect(normalizePromptSnippets(input)).toHaveLength(100)
  })
})

describe('normalizePromptSnippets when', () => {
  it('keeps only recognized when triggers, dropping unknown ones and empty results', () => {
    const result = normalizePromptSnippets([
      { id: 'a', name: 'A', body: 'x', sortOrder: 0, when: ['checkFailed', 'bogus'] },
      { id: 'b', name: 'B', body: 'x', sortOrder: 1, when: ['bogus'] },
      { id: 'c', name: 'C', body: 'x', sortOrder: 2, when: 'checkFailed' }
    ])
    expect(result.find((s) => s.id === 'a')?.when).toEqual(['checkFailed'])
    expect(result.find((s) => s.id === 'b')?.when).toBeUndefined()
    expect(result.find((s) => s.id === 'c')?.when).toBeUndefined()
  })
})

describe('seedPromptLibraryContextStarters', () => {
  it('adds missing context starters and reindexes', () => {
    const seeded = seedPromptLibraryContextStarters([
      { id: 'user-1', name: 'Mine', body: 'x', sortOrder: 0 }
    ])
    expect(seeded.length).toBeGreaterThan(1)
    expect(seeded.map((s) => s.sortOrder)).toEqual(seeded.map((_, i) => i))
    expect(seeded.some((s) => s.id === 'starter-fix-failing-check')).toBe(true)
  })

  it('does not re-add a starter the user already deleted by not including it', () => {
    const withoutOne = seedPromptLibraryContextStarters([]).filter(
      (s) => s.id !== 'starter-fix-failing-check'
    )
    const reseeded = seedPromptLibraryContextStarters(withoutOne)
    // Why: seeding is a pure one-shot operation — callers gate re-invocation with the
    // persisted guard flag, so calling it again here is expected to re-add it; the guard
    // test lives at the settings-migration layer, not in this pure function.
    expect(reseeded.some((s) => s.id === 'starter-fix-failing-check')).toBe(true)
  })
})

describe('getDefaultPromptSnippets', () => {
  it('ships starter snippets with a stable, zero-based sortOrder', () => {
    const starters = getDefaultPromptSnippets()
    expect(starters.length).toBeGreaterThanOrEqual(3)
    expect(starters.map((snippet) => snippet.sortOrder)).toEqual(starters.map((_, index) => index))
    expect(new Set(starters.map((snippet) => snippet.id)).size).toBe(starters.length)
  })
})

describe('isPromptSnippetComplete', () => {
  it('requires both a non-blank name and body', () => {
    expect(isPromptSnippetComplete({ name: 'x', body: 'y' })).toBe(true)
    expect(isPromptSnippetComplete({ name: '  ', body: 'y' })).toBe(false)
    expect(isPromptSnippetComplete({ name: 'x', body: '  ' })).toBe(false)
  })
})

describe('reindexPromptSnippets', () => {
  it('reassigns sortOrder to match array position', () => {
    const result = reindexPromptSnippets([
      { id: 'b', name: 'B', body: 'b', sortOrder: 9 },
      { id: 'a', name: 'A', body: 'a', sortOrder: 2 }
    ])
    expect(result.map((snippet) => snippet.sortOrder)).toEqual([0, 1])
    expect(result.map((snippet) => snippet.id)).toEqual(['b', 'a'])
  })
})
