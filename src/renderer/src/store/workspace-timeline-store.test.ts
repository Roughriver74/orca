import { describe, expect, it } from 'vitest'
import {
  appendWorkspaceTimelineEntries,
  type WorkspaceTimelinePersistedState
} from './workspace-timeline-store'
import {
  WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE,
  WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES,
  type WorkspaceTimelineStateEntry
} from '../components/right-sidebar/workspace-timeline/workspace-timeline-types'

function stateEntry(worktreeId: string, timestamp: number): WorkspaceTimelineStateEntry {
  return {
    kind: 'state',
    id: `${worktreeId}:${timestamp}`,
    worktreeId,
    paneKey: 'tab-1:0',
    agentType: 'claude',
    timestamp,
    state: 'done',
    fromState: 'working'
  }
}

describe('appendWorkspaceTimelineEntries', () => {
  it('appends new entries after the existing ones for the same workspace', () => {
    const state: WorkspaceTimelinePersistedState = { a: [stateEntry('a', 1)] }
    const next = appendWorkspaceTimelineEntries(state, 'a', [stateEntry('a', 2)])
    expect(next.a.map((entry) => entry.timestamp)).toEqual([1, 2])
  })

  it('returns the same reference when there is nothing to append', () => {
    const state: WorkspaceTimelinePersistedState = { a: [stateEntry('a', 1)] }
    expect(appendWorkspaceTimelineEntries(state, 'a', [])).toBe(state)
  })

  it('trims the oldest entries once a workspace exceeds its cap', () => {
    const existing = Array.from({ length: WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE }, (_, i) =>
      stateEntry('a', i)
    )
    const state: WorkspaceTimelinePersistedState = { a: existing }
    const next = appendWorkspaceTimelineEntries(state, 'a', [
      stateEntry('a', WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE)
    ])
    expect(next.a).toHaveLength(WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE)
    expect(next.a[0].timestamp).toBe(1)
    expect(next.a.at(-1)?.timestamp).toBe(WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE)
  })

  it('evicts the workspace whose newest entry is oldest once the tracked cap is exceeded', () => {
    const state: WorkspaceTimelinePersistedState = {}
    for (let i = 0; i < WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES; i += 1) {
      state[`wt-${i}`] = [stateEntry(`wt-${i}`, i)]
    }
    // wt-0 has the oldest newest-entry timestamp (0), so adding one more workspace evicts it.
    const next = appendWorkspaceTimelineEntries(state, 'wt-new', [stateEntry('wt-new', 1000)])
    expect(Object.keys(next)).toHaveLength(WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES)
    expect(next['wt-0']).toBeUndefined()
    expect(next['wt-new']).toBeDefined()
  })
})
