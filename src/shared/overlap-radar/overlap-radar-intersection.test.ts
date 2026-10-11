import { describe, expect, it } from 'vitest'
import {
  computeOverlapRadarMatches,
  isOverlapRadarLockfilePath,
  type OverlapRadarWorktreeChanges
} from './overlap-radar-intersection'

function worktree(
  worktreeId: string,
  repoId: string,
  changedPaths: string[],
  displayName = worktreeId
): OverlapRadarWorktreeChanges {
  return { worktreeId, repoId, displayName, changedPaths }
}

describe('computeOverlapRadarMatches', () => {
  it('flags two sibling worktrees that both touch the same file', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['src/a.ts', 'src/only-a.ts'], 'Workspace A'),
      worktree('b', 'repo-1', ['src/a.ts', 'src/only-b.ts'], 'Workspace B')
    ])

    expect(matches.a).toEqual([
      {
        worktreeId: 'b',
        displayName: 'Workspace B',
        files: [{ path: 'src/a.ts', isLockfile: false }]
      }
    ])
    expect(matches.b).toEqual([
      {
        worktreeId: 'a',
        displayName: 'Workspace A',
        files: [{ path: 'src/a.ts', isLockfile: false }]
      }
    ])
  })

  it('reports no overlap when changed-file sets are disjoint', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['src/only-a.ts']),
      worktree('b', 'repo-1', ['src/only-b.ts'])
    ])

    expect(matches).toEqual({})
  })

  it('never crosses repos even when paths collide', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['src/a.ts']),
      worktree('b', 'repo-2', ['src/a.ts'])
    ])

    expect(matches).toEqual({})
  })

  it('omits a worktree with no siblings in its repo', () => {
    const matches = computeOverlapRadarMatches([worktree('a', 'repo-1', ['src/a.ts'])])

    expect(matches).toEqual({})
  })

  it('omits a worktree with an empty changed-file set', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', []),
      worktree('b', 'repo-1', ['src/a.ts'])
    ])

    expect(matches.a).toBeUndefined()
    expect(matches.b).toBeUndefined()
  })

  it('flags a lockfile collision but marks it as low-alarm', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['pnpm-lock.yaml']),
      worktree('b', 'repo-1', ['pnpm-lock.yaml'])
    ])

    expect(matches.a).toEqual([
      { worktreeId: 'b', displayName: 'b', files: [{ path: 'pnpm-lock.yaml', isLockfile: true }] }
    ])
  })

  it('gives each worktree only its own overlapping peers in a three-way group', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['src/shared.ts', 'src/a-only.ts']),
      worktree('b', 'repo-1', ['src/shared.ts']),
      worktree('c', 'repo-1', ['src/unrelated.ts'])
    ])

    expect(matches.a).toEqual([
      { worktreeId: 'b', displayName: 'b', files: [{ path: 'src/shared.ts', isLockfile: false }] }
    ])
    expect(matches.b).toEqual([
      { worktreeId: 'a', displayName: 'a', files: [{ path: 'src/shared.ts', isLockfile: false }] }
    ])
    expect(matches.c).toBeUndefined()
  })

  it('sorts peers by display name and files by path for stable output', () => {
    const matches = computeOverlapRadarMatches([
      worktree('a', 'repo-1', ['src/z.ts', 'src/b.ts']),
      worktree('b', 'repo-1', ['src/z.ts', 'src/b.ts'], 'Zeta'),
      worktree('c', 'repo-1', ['src/z.ts', 'src/b.ts'], 'Alpha')
    ])

    expect(matches.a?.map((peer) => peer.displayName)).toEqual(['Alpha', 'Zeta'])
    expect(matches.a?.[0].files.map((file) => file.path)).toEqual(['src/b.ts', 'src/z.ts'])
  })
})

describe('isOverlapRadarLockfilePath', () => {
  it('recognizes common package manager lockfiles by basename', () => {
    expect(isOverlapRadarLockfilePath('pnpm-lock.yaml')).toBe(true)
    expect(isOverlapRadarLockfilePath('packages/app/package-lock.json')).toBe(true)
    expect(isOverlapRadarLockfilePath('Cargo.lock')).toBe(true)
  })

  it('does not flag ordinary source files', () => {
    expect(isOverlapRadarLockfilePath('src/a.ts')).toBe(false)
    expect(isOverlapRadarLockfilePath('lockfile-utils.ts')).toBe(false)
  })
})
