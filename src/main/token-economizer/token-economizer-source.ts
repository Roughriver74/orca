import { existsSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runPluginGit } from '../plugins/plugin-git-repository'

const TOKEN_ECONOMIZER_REPO_URL = 'https://github.com/microsoft/TokenEconomizer.git'
// Orca installs exactly this commit; bumping it is the only way TE updates.
const TOKEN_ECONOMIZER_COMMIT = '1deb887bb6816188e24580f8812e65288af5757c'

export function getTokenEconomizerCloneDir(dataRoot: string): string {
  return join(dataRoot, 'token-economizer', 'TokenEconomizer')
}

async function checkoutPinnedCommit(cloneDir: string): Promise<void> {
  await runPluginGit(
    ['fetch', '--quiet', '--depth', '1', 'origin', TOKEN_ECONOMIZER_COMMIT],
    cloneDir
  )
  await runPluginGit(['checkout', '--quiet', '--force', 'FETCH_HEAD'], cloneDir)
  if ((await runPluginGit(['rev-parse', 'HEAD'], cloneDir)) !== TOKEN_ECONOMIZER_COMMIT) {
    throw new Error('TokenEconomizer checkout did not land on the pinned commit')
  }
}

/** Leaves the clone at the pinned commit; the installed plugins run from it, so it must stay. */
export async function ensureTokenEconomizerSource(dataRoot: string): Promise<string> {
  const cloneDir = getTokenEconomizerCloneDir(dataRoot)
  if (existsSync(join(cloneDir, '.git'))) {
    try {
      if ((await runPluginGit(['rev-parse', 'HEAD'], cloneDir)) === TOKEN_ECONOMIZER_COMMIT) {
        return cloneDir
      }
      await checkoutPinnedCommit(cloneDir)
      return cloneDir
    } catch (error) {
      console.warn('[token-economizer] clone unusable, re-cloning:', error)
    }
  }
  // Installed plugins run from cloneDir, so it is replaced only once a fresh clone is at the pinned commit.
  const nextDir = `${cloneDir}.next`
  await rm(nextDir, { recursive: true, force: true })
  await mkdir(nextDir, { recursive: true })
  await runPluginGit(['init', '--quiet'], nextDir)
  await runPluginGit(['remote', 'add', 'origin', TOKEN_ECONOMIZER_REPO_URL], nextDir)
  await checkoutPinnedCommit(nextDir)
  await rm(cloneDir, { recursive: true, force: true })
  await rename(nextDir, cloneDir)
  return cloneDir
}
