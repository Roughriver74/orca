import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clearWorkspaceReviewed,
  getReviewedChanges,
  markWorkspaceReviewed,
  reviewedRefName,
  reviewedScopeKey,
  type ReviewedGitExec
} from './reviewed-snapshot'

const execFileAsync = promisify(execFile)
const tempRoots: string[] = []

async function createRepo(): Promise<string> {
  const repo = await mkdtemp(path.join(tmpdir(), 'orca-reviewed-snapshot-'))
  tempRoots.push(repo)
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: repo })
  await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: repo })
  return repo
}

function execIn(repo: string): ReviewedGitExec {
  return (args: string[]) => execFileAsync('git', args, { cwd: repo })
}

async function commitFile(repo: string, relativePath: string, content: string): Promise<void> {
  await writeFile(path.join(repo, relativePath), content)
  await execFileAsync('git', ['add', relativePath], { cwd: repo })
  await execFileAsync('git', ['commit', '-q', '-m', `write ${relativePath}`], { cwd: repo })
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('reviewed snapshot', () => {
  it('reports unreviewed when the workspace was never marked', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const result = await getReviewedChanges(execIn(repo), reviewedScopeKey(null, repo))
    expect(result).toEqual({ reviewed: false })
  })

  it('lists only files changed after the mark, not before it', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'before.txt', 'original\n')

    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    const mark = await markWorkspaceReviewed(exec, scopeKey)
    expect(mark.reviewedOid).toMatch(/^[0-9a-f]{40}$/)
    expect(mark.reviewedAt).toBeTruthy()

    // Edits after the mark — only these two should show up.
    await writeFile(path.join(repo, 'edited-a.txt'), 'changed a\n')
    await writeFile(path.join(repo, 'edited-b.txt'), 'changed b\n')
    await execFileAsync('git', ['add', 'edited-a.txt', 'edited-b.txt'], { cwd: repo })
    await execFileAsync('git', ['commit', '-q', '-m', 'agent edits'], { cwd: repo })

    const result = await getReviewedChanges(exec, scopeKey)
    expect(result.reviewed).toBe(true)
    if (!result.reviewed) {
      throw new Error('expected reviewed result')
    }
    expect(result.compare.summary.status).toBe('ready')
    expect(result.compare.summary.changedFiles).toBe(2)
    const paths = result.compare.entries.map((entry) => entry.path).sort()
    expect(paths).toEqual(['edited-a.txt', 'edited-b.txt'])
    expect(paths).not.toContain('before.txt')
  })

  it('includes uncommitted (unstaged and staged) edits without touching the index or HEAD', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'tracked.txt', 'v1\n')
    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    await markWorkspaceReviewed(exec, scopeKey)

    await writeFile(path.join(repo, 'tracked.txt'), 'v2\n')
    const { stdout: indexBefore } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repo
    })
    expect(indexBefore).toBe(' M tracked.txt\n')

    const result = await getReviewedChanges(exec, scopeKey)
    expect(result.reviewed).toBe(true)
    if (!result.reviewed) {
      throw new Error('expected reviewed result')
    }
    expect(result.compare.entries.map((entry) => entry.path)).toEqual(['tracked.txt'])

    // The real index/working tree are untouched — same status as before the diff was computed.
    const { stdout: indexAfter } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: repo
    })
    expect(indexAfter).toBe(' M tracked.txt\n')
    const { stdout: headAfter } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo })
    const { stdout: headBefore } = await execFileAsync('git', ['rev-parse', 'main'], { cwd: repo })
    expect(headAfter.trim()).toBe(headBefore.trim())
    const { stdout: stashList } = await execFileAsync('git', ['stash', 'list'], { cwd: repo })
    expect(stashList.trim()).toBe('')
  })

  it('reports no changes once nothing has moved since the mark', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    await markWorkspaceReviewed(exec, scopeKey)

    const result = await getReviewedChanges(exec, scopeKey)
    expect(result.reviewed).toBe(true)
    if (!result.reviewed) {
      throw new Error('expected reviewed result')
    }
    expect(result.compare.entries).toEqual([])
    expect(result.compare.summary.changedFiles).toBe(0)
  })

  it('re-marking moves the baseline forward', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    await markWorkspaceReviewed(exec, scopeKey)

    await commitFile(repo, 'b.txt', 'b\n')
    const afterFirstMark = await getReviewedChanges(exec, scopeKey)
    if (!afterFirstMark.reviewed) {
      throw new Error('expected reviewed result')
    }
    expect(afterFirstMark.compare.entries.map((entry) => entry.path)).toEqual(['b.txt'])

    await markWorkspaceReviewed(exec, scopeKey)
    const afterSecondMark = await getReviewedChanges(exec, scopeKey)
    if (!afterSecondMark.reviewed) {
      throw new Error('expected reviewed result')
    }
    expect(afterSecondMark.compare.entries).toEqual([])
  })

  it('persists the snapshot under a private ref that survives across calls', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    const mark = await markWorkspaceReviewed(exec, scopeKey)

    const refName = reviewedRefName(scopeKey)
    expect(refName).toMatch(/^refs\/orca\/reviewed\/[0-9a-f]{64}$/)
    const { stdout: refOid } = await execFileAsync('git', ['rev-parse', refName], { cwd: repo })
    expect(refOid.trim()).toBe(mark.reviewedOid)

    // Not a branch or tag the user would see.
    const { stdout: branches } = await execFileAsync('git', ['branch', '--list'], { cwd: repo })
    expect(branches).not.toContain('reviewed')
    const { stdout: tags } = await execFileAsync('git', ['tag', '--list'], { cwd: repo })
    expect(tags.trim()).toBe('')
  })

  it('scopes snapshots per workspace so two worktrees never collide', async () => {
    const repoA = await createRepo()
    const repoB = await createRepo()
    await commitFile(repoA, 'a.txt', 'a\n')
    await commitFile(repoB, 'b.txt', 'b\n')

    await markWorkspaceReviewed(execIn(repoA), reviewedScopeKey(null, repoA))
    // repoB was never marked — its own scope key must report unreviewed independently of repoA.
    const resultB = await getReviewedChanges(execIn(repoB), reviewedScopeKey(null, repoB))
    expect(resultB).toEqual({ reviewed: false })
  })

  it('clearWorkspaceReviewed removes the ref so the workspace reports unreviewed again', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const exec = execIn(repo)
    const scopeKey = reviewedScopeKey(null, repo)
    await markWorkspaceReviewed(exec, scopeKey)

    await clearWorkspaceReviewed(exec, scopeKey)

    const result = await getReviewedChanges(exec, scopeKey)
    expect(result).toEqual({ reviewed: false })
  })

  it('clearWorkspaceReviewed is a no-op when nothing was ever marked', async () => {
    const repo = await createRepo()
    await commitFile(repo, 'a.txt', 'a\n')
    const exec = execIn(repo)
    await expect(
      clearWorkspaceReviewed(exec, reviewedScopeKey(null, repo))
    ).resolves.toBeUndefined()
  })
})
