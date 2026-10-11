import { describe, expect, it } from 'vitest'
import { resolvePromptLibraryInsertTarget } from './resolve-prompt-library-insert-target'

const WT = 'repo::/path/wt'
const GROUP = 'group-1'
const TAB = 'tab-1'
const LEAF = 'leaf-1'

function baseState(): Parameters<typeof resolvePromptLibraryInsertTarget>[0] {
  return {
    activeWorktreeId: WT,
    activeGroupIdByWorktree: { [WT]: GROUP },
    groupsByWorktree: {
      [WT]: [{ id: GROUP, worktreeId: WT, activeTabId: TAB, tabOrder: [TAB] }]
    },
    terminalLayoutsByTabId: {
      [TAB]: {
        root: null,
        activeLeafId: LEAF,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF]: 'pty-1' }
      }
    }
  }
}

describe('resolvePromptLibraryInsertTarget', () => {
  it('resolves the pty backing the active leaf of the active tab', () => {
    expect(resolvePromptLibraryInsertTarget(baseState())).toEqual({ ptyId: 'pty-1', tabId: TAB })
  })

  it('returns null when no worktree is active', () => {
    expect(resolvePromptLibraryInsertTarget({ ...baseState(), activeWorktreeId: null })).toBeNull()
  })

  it('returns null when the active worktree has no active group', () => {
    expect(
      resolvePromptLibraryInsertTarget({ ...baseState(), activeGroupIdByWorktree: {} })
    ).toBeNull()
  })

  it('returns null when the active group has no active tab', () => {
    const state = baseState()
    state.groupsByWorktree[WT] = [{ id: GROUP, worktreeId: WT, activeTabId: null, tabOrder: [] }]
    expect(resolvePromptLibraryInsertTarget(state)).toBeNull()
  })

  it('returns null for a tab with no terminal layout (e.g. an editor tab)', () => {
    expect(
      resolvePromptLibraryInsertTarget({ ...baseState(), terminalLayoutsByTabId: {} })
    ).toBeNull()
  })

  it('returns null when the active leaf has no bound pty yet', () => {
    const state = baseState()
    state.terminalLayoutsByTabId[TAB] = {
      root: null,
      activeLeafId: LEAF,
      expandedLeafId: null,
      ptyIdsByLeafId: {}
    }
    expect(resolvePromptLibraryInsertTarget(state)).toBeNull()
  })
})
