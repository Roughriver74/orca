import { describe, expect, it } from 'vitest'
import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
import type { Worktree } from '../../../shared/worktree/types'
import {
  selectIdleWorktreeIdsForAutoArchive,
  type AutoArchiveState
} from './workspace-auto-archive'

const DAY = 24 * 60 * 60 * 1000
const NOW = 100 * DAY
const IDLE_MS = 2 * DAY

function state(worktrees: Worktree[], overrides: Partial<AutoArchiveState> = {}): AutoArchiveState {
  return {
    worktreesByRepo: { repo1: worktrees },
    activeWorktreeId: null,
    lastVisitedAtByWorktreeId: {},
    agentStatusByPaneKey: {},
    tabsByWorktree: {},
    deleteStateByWorktreeId: {},
    ...overrides
  }
}

const idle = (id: string, overrides: Partial<Worktree> = {}): Worktree =>
  makeWorktree({
    id,
    repoId: 'repo1',
    path: `/w/${id}`,
    lastActivityAt: NOW - 3 * DAY,
    ...overrides
  })

describe('selectIdleWorktreeIdsForAutoArchive', () => {
  it('picks workspaces idle past the threshold and keeps fresher ones', () => {
    const ids = selectIdleWorktreeIdsForAutoArchive(
      state([
        idle('repo1::/w/old'),
        idle('repo1::/w/edge', { lastActivityAt: NOW - IDLE_MS }),
        idle('repo1::/w/recent', { lastActivityAt: NOW - IDLE_MS + 1 }),
        idle('repo1::/w/terminal', { lastTerminalUseAt: NOW - DAY })
      ]),
      NOW,
      IDLE_MS
    )
    expect(ids.sort()).toEqual(['repo1::/w/edge', 'repo1::/w/old'])
  })

  it('treats a recent visit as activity', () => {
    const ids = selectIdleWorktreeIdsForAutoArchive(
      state([idle('repo1::/w/a')], {
        lastVisitedAtByWorktreeId: { 'repo1::/w/a': NOW - DAY }
      }),
      NOW,
      IDLE_MS
    )
    expect(ids).toEqual([])
  })

  it('never picks the open, pinned, primary, archived, deleting or stampless workspace', () => {
    const ids = selectIdleWorktreeIdsForAutoArchive(
      state(
        [
          idle('repo1::/w/active'),
          idle('repo1::/w/pinned', { isPinned: true }),
          idle('repo1::/w/main', { isMainWorktree: true }),
          idle('repo1::/w/archived', { isArchived: true }),
          idle('repo1::/w/removing', { removing: true }),
          idle('repo1::/w/deleting'),
          idle('repo1::/w/unknown', { lastActivityAt: 0 })
        ],
        {
          activeWorktreeId: 'repo1::/w/active',
          deleteStateByWorktreeId: {
            'repo1::/w/deleting': {
              isDeleting: true,
              error: null,
              canForceDelete: false,
              forceDeleteReason: null
            }
          }
        }
      ),
      NOW,
      IDLE_MS
    )
    expect(ids).toEqual([])
  })

  it('keeps a host-twinned id when any copy is still active', () => {
    const id = 'repo1::/w/twin'
    const ids = selectIdleWorktreeIdsForAutoArchive(
      state([idle(id, { hostId: 'local' }), idle(id, { hostId: 'ssh:box' })], {
        lastVisitedAtByWorktreeId: { [`ssh:box|${id}`]: NOW - DAY }
      }),
      NOW,
      IDLE_MS
    )
    expect(ids).toEqual([])
  })
})
