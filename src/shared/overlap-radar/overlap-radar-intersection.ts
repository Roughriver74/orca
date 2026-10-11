/**
 * Overlap radar: warns when two or more worktrees of the same repo have touched the
 * same file, before it becomes a merge conflict. This module is pure (no git, no
 * store) so the intersection logic is unit-testable in isolation.
 */

/** A worktree's changed-file set: committed-since-base entries plus uncommitted ones. */
export type OverlapRadarWorktreeChanges = {
  worktreeId: string
  repoId: string
  displayName: string
  changedPaths: readonly string[]
}

export type OverlapRadarOverlapFile = {
  path: string
  /** Lockfiles still appear in the list but are flagged so the UI can treat them as a lower-alarm, auto-regenerable collision instead of a real conflict risk. */
  isLockfile: boolean
}

export type OverlapRadarPeerOverlap = {
  worktreeId: string
  displayName: string
  files: OverlapRadarOverlapFile[]
}

// Why: these regenerate deterministically from the manifest, so two worktrees touching
// the same lockfile rarely need a manual merge — listed, but not alarming by default.
const OVERLAP_RADAR_LOCKFILE_BASENAMES: Record<string, true> = {
  'package-lock.json': true,
  'npm-shrinkwrap.json': true,
  'pnpm-lock.yaml': true,
  'yarn.lock': true,
  'bun.lockb': true,
  'bun.lock': true,
  'Cargo.lock': true,
  'Gemfile.lock': true,
  'composer.lock': true,
  'poetry.lock': true,
  'Pipfile.lock': true,
  'go.sum': true,
  'mix.lock': true,
  'flake.lock': true
}

export function isOverlapRadarLockfilePath(path: string): boolean {
  const basename = path.slice(path.lastIndexOf('/') + 1)
  return Object.hasOwn(OVERLAP_RADAR_LOCKFILE_BASENAMES, basename)
}

/**
 * Per-worktree overlaps against its sibling worktrees (same repoId, two-plus worktrees
 * with a non-empty changed set). Worktrees with no overlap are omitted from the result.
 */
export function computeOverlapRadarMatches(
  worktrees: readonly OverlapRadarWorktreeChanges[]
): Record<string, OverlapRadarPeerOverlap[]> {
  const byRepo = new Map<string, OverlapRadarWorktreeChanges[]>()
  for (const worktree of worktrees) {
    const group = byRepo.get(worktree.repoId)
    if (group) {
      group.push(worktree)
    } else {
      byRepo.set(worktree.repoId, [worktree])
    }
  }

  const result: Record<string, OverlapRadarPeerOverlap[]> = {}
  for (const group of byRepo.values()) {
    if (group.length < 2) {
      continue
    }
    for (const worktree of group) {
      const ownPaths = new Set(worktree.changedPaths)
      if (ownPaths.size === 0) {
        continue
      }
      const peers: OverlapRadarPeerOverlap[] = []
      for (const other of group) {
        if (other.worktreeId === worktree.worktreeId) {
          continue
        }
        const files: OverlapRadarOverlapFile[] = []
        for (const path of new Set(other.changedPaths)) {
          if (ownPaths.has(path)) {
            files.push({ path, isLockfile: isOverlapRadarLockfilePath(path) })
          }
        }
        if (files.length === 0) {
          continue
        }
        files.sort((a, b) => a.path.localeCompare(b.path))
        peers.push({ worktreeId: other.worktreeId, displayName: other.displayName, files })
      }
      if (peers.length > 0) {
        peers.sort((a, b) => a.displayName.localeCompare(b.displayName))
        result[worktree.worktreeId] = peers
      }
    }
  }
  return result
}
