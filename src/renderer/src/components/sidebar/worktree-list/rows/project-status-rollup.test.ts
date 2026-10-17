import { describe, expect, it } from 'vitest'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { rollUpProjectStatus } from './project-status-rollup'

const rollUp = (...statuses: WorktreeStatus[]): WorktreeStatus | undefined =>
  rollUpProjectStatus(new Map(statuses.map((status, index) => [`wt-${index}`, status])))

describe('rollUpProjectStatus', () => {
  // Reported: a finished default branch kept a project green while another workspace worked.
  it('shows work in progress over a finished or idle workspace', () => {
    expect(rollUp('done', 'inactive', 'working')).toBe('working')
    expect(rollUp('inactive', 'active', 'working')).toBe('working')
  })

  it('lets a question or a failure outrank work in progress', () => {
    expect(rollUp('working', 'permission', 'done')).toBe('permission')
    expect(rollUp('working', 'failed')).toBe('failed')
  })

  it('prefers a finished workspace over an open quiet one', () => {
    expect(rollUp('active', 'done', 'inactive')).toBe('done')
  })

  it('has no dot for a project with no workspaces', () => {
    expect(rollUp()).toBeUndefined()
  })
})
