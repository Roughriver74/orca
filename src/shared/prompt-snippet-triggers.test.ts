import { describe, expect, it } from 'vitest'
import {
  evaluatePromptSnippetTriggers,
  promptSnippetTriggersSatisfied
} from './prompt-snippet-triggers'

const BASE_INPUT = {
  agentStatus: null,
  checkState: null,
  hasLinkedWorkItem: false,
  changedPaths: [],
  overlappingSiblingPaths: []
}

describe('evaluatePromptSnippetTriggers', () => {
  it('returns an empty set when nothing is true', () => {
    expect(evaluatePromptSnippetTriggers(BASE_INPUT)).toEqual(new Set())
  })

  it('adds checkFailed only when the check status is failed', () => {
    expect(
      evaluatePromptSnippetTriggers({ ...BASE_INPUT, checkState: { status: 'failed' } })
    ).toEqual(new Set(['checkFailed']))
    expect(
      evaluatePromptSnippetTriggers({ ...BASE_INPUT, checkState: { status: 'passed' } })
    ).toEqual(new Set())
    expect(
      evaluatePromptSnippetTriggers({ ...BASE_INPUT, checkState: { status: 'running' } })
    ).toEqual(new Set())
  })

  it('adds overlap only when sibling overlap paths are non-empty', () => {
    expect(
      evaluatePromptSnippetTriggers({
        ...BASE_INPUT,
        overlappingSiblingPaths: ['src/a.ts']
      })
    ).toEqual(new Set(['overlap']))
  })

  it('adds agentDone for a normal completion but not an interrupted one', () => {
    expect(
      evaluatePromptSnippetTriggers({
        ...BASE_INPUT,
        agentStatus: { state: 'done' }
      })
    ).toEqual(new Set(['agentDone']))
    expect(
      evaluatePromptSnippetTriggers({
        ...BASE_INPUT,
        agentStatus: { state: 'done', interrupted: true }
      })
    ).toEqual(new Set())
    expect(
      evaluatePromptSnippetTriggers({
        ...BASE_INPUT,
        agentStatus: { state: 'working' }
      })
    ).toEqual(new Set())
  })

  it('adds hasIssue only when a work item is linked', () => {
    expect(evaluatePromptSnippetTriggers({ ...BASE_INPUT, hasLinkedWorkItem: true })).toEqual(
      new Set(['hasIssue'])
    )
  })

  it('adds hasChanges only when changedPaths is non-empty', () => {
    expect(
      evaluatePromptSnippetTriggers({ ...BASE_INPUT, changedPaths: ['src/a.ts'] })
    ).toEqual(new Set(['hasChanges']))
  })

  it('combines multiple true triggers', () => {
    expect(
      evaluatePromptSnippetTriggers({
        agentStatus: { state: 'done' },
        checkState: { status: 'failed' },
        hasLinkedWorkItem: true,
        changedPaths: ['a.ts'],
        overlappingSiblingPaths: ['a.ts']
      })
    ).toEqual(new Set(['checkFailed', 'overlap', 'agentDone', 'hasIssue', 'hasChanges']))
  })
})

describe('promptSnippetTriggersSatisfied', () => {
  it('is false when when is absent or empty', () => {
    const active = new Set(['agentDone', 'hasChanges'] as const)
    expect(promptSnippetTriggersSatisfied(undefined, active)).toBe(false)
    expect(promptSnippetTriggersSatisfied([], active)).toBe(false)
  })

  it('requires every listed trigger to be active', () => {
    const active = new Set(['agentDone', 'hasChanges'] as const)
    expect(promptSnippetTriggersSatisfied(['agentDone'], active)).toBe(true)
    expect(promptSnippetTriggersSatisfied(['agentDone', 'hasChanges'], active)).toBe(true)
    expect(promptSnippetTriggersSatisfied(['agentDone', 'hasIssue'], active)).toBe(false)
  })
})
