import { describe, expect, it } from 'vitest'
import { mergeWorkspaceTimelineEntries } from './workspace-timeline-merge'
import type {
  WorkspaceTimelineCommitEntry,
  WorkspaceTimelineEntry,
  WorkspaceTimelinePromptEntry,
  WorkspaceTimelineStateEntry
} from './workspace-timeline-types'

const WORKTREE_ID = 'repo-1::/path/to/wt'

function prompt(timestamp: number, text = 'Fix the bug'): WorkspaceTimelinePromptEntry {
  return {
    kind: 'prompt',
    id: `prompt:${timestamp}`,
    worktreeId: WORKTREE_ID,
    paneKey: 'tab-1:0',
    agentType: 'claude',
    timestamp,
    text
  }
}

function state(
  timestamp: number,
  value: WorkspaceTimelineStateEntry['state'],
  fromState: WorkspaceTimelineStateEntry['fromState'] = null
): WorkspaceTimelineStateEntry {
  return {
    kind: 'state',
    id: `state:${timestamp}:${value}`,
    worktreeId: WORKTREE_ID,
    paneKey: 'tab-1:0',
    agentType: 'claude',
    timestamp,
    state: value,
    fromState
  }
}

function commit(timestamp: number, commitId = 'abc123'): WorkspaceTimelineCommitEntry {
  return {
    kind: 'commit',
    id: `commit:${commitId}`,
    worktreeId: WORKTREE_ID,
    timestamp,
    commitId,
    subject: 'Fix the bug',
    message: 'Fix the bug'
  }
}

describe('mergeWorkspaceTimelineEntries', () => {
  it('orders a prompt, a working→done transition, and a commit newest-first by timestamp', () => {
    const promptEntry = prompt(1_000)
    const workingEntry = state(1_000, 'working')
    const doneEntry = state(2_000, 'done', 'working')
    const commitEntry = commit(3_000)

    const merged = mergeWorkspaceTimelineEntries(
      [promptEntry, workingEntry, doneEntry],
      [commitEntry]
    )

    expect(merged.map((entry) => entry.id)).toEqual([
      commitEntry.id,
      doneEntry.id,
      // promptEntry and workingEntry share a timestamp; the tie-break orders prompt first.
      promptEntry.id,
      workingEntry.id
    ])
  })

  it('breaks ties at the same timestamp by kind: commit, then prompt, then state, then file', () => {
    const tied = 5_000
    const fileEntry: WorkspaceTimelineEntry = {
      kind: 'file',
      id: 'file:1',
      worktreeId: WORKTREE_ID,
      paneKey: 'tab-1:0',
      agentType: 'claude',
      timestamp: tied,
      path: 'src/foo.ts',
      toolName: 'Edit'
    }
    const stateEntry = state(tied, 'working')
    const promptEntry = prompt(tied)
    const commitEntry = commit(tied)

    const merged = mergeWorkspaceTimelineEntries(
      [fileEntry, stateEntry, promptEntry],
      [commitEntry]
    )

    expect(merged.map((entry) => entry.kind)).toEqual(['commit', 'prompt', 'state', 'file'])
  })

  it('is deterministic for two same-kind entries at the same timestamp, ordered by id', () => {
    const a = commit(9_000, 'aaa')
    const b = commit(9_000, 'bbb')

    expect(mergeWorkspaceTimelineEntries([], [b, a]).map((entry) => entry.id)).toEqual([b.id, a.id])
  })

  it('returns entries unchanged when there is nothing to merge', () => {
    expect(mergeWorkspaceTimelineEntries([], [])).toEqual([])
  })
})
