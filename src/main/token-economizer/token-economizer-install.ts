import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { runProcess } from '@orca/process-host'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getTuiAgentDetectCommands, TUI_AGENT_CONFIG } from '../../shared/tui-agent-config'
import type { TokenEconomizerStatus } from '../../shared/token-economizer-status'
import { detectLocalManagedAgentCliPresence } from '../agent-hooks/local-agent-cli-presence'
import { listClaudeProfileHomes } from '../claude-accounts/claude-profile-installed-router'
import {
  getOrcaUserDataPath,
  getSystemCodexHomePath,
  resolveOrcaManagedCodexHomePath
} from '../codex/codex-home-paths'
import { grantTokenEconomizerCodexTrust } from './token-economizer-codex-trust'
import {
  getTokenEconomizerOmpPackageDir,
  writeTokenEconomizerOmpPackage
} from './token-economizer-omp-package'
import {
  planTokenEconomizer,
  TOKEN_ECONOMIZER_AGENT_CLIS,
  TOKEN_ECONOMIZER_AGENTS,
  type TokenEconomizerAgent,
  type TokenEconomizerStep,
  type TokenEconomizerTarget
} from './token-economizer-plan'
import { findTokenEconomizerPython } from './token-economizer-python'
import { ensureTokenEconomizerSource, getTokenEconomizerCloneDir } from './token-economizer-source'

const AGENT_CLI_TIMEOUT_MS = 120_000
const MAX_DETAIL_CHARS = 300

type ApplyOptions = {
  settings?: Pick<GlobalSettings, 'agentCmdOverrides' | 'codexManagedAccounts'> | null
  shouldHydrateShellPath?: boolean
}
type FoundTarget = TokenEconomizerTarget & { executable: string }

let status: TokenEconomizerStatus = { state: 'off' }
const listeners = new Set<(status: TokenEconomizerStatus) => void>()

export function getTokenEconomizerStatus(): TokenEconomizerStatus {
  return status
}

export function onTokenEconomizerStatusChanged(
  listener: (status: TokenEconomizerStatus) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setStatus(next: TokenEconomizerStatus): void {
  status = next
  for (const listener of listeners) {
    listener(next)
  }
}

function describeHome(target: TokenEconomizerTarget): string {
  return target.home ?? (target.agent === 'claude' ? join(homedir(), '.claude') : target.agent)
}

function listHomes(
  agent: TokenEconomizerAgent,
  dataRoot: string,
  settings: ApplyOptions['settings']
): (string | null)[] {
  if (agent === 'claude') {
    // null keeps Claude's own default home (no CLAUDE_CONFIG_DIR).
    return [null, ...listClaudeProfileHomes(dataRoot)]
  }
  if (agent === 'omp') {
    return [null]
  }
  const accountHomes = (settings?.codexManagedAccounts ?? [])
    .filter((account) => account.managedHomeRuntime !== 'wsl')
    .map((account) => account.managedHomePath)
  // Codex refuses a CODEX_HOME that does not exist; a home Codex has not created yet is picked up at the next launch.
  const homes = [getSystemCodexHomePath(), resolveOrcaManagedCodexHomePath(), ...accountHomes]
  return [...new Set(homes)].filter((home) => existsSync(home))
}

async function runAgentCli(target: FoundTarget, args: readonly string[]): Promise<string> {
  const env = { ...process.env }
  const { homeEnvVar, dropEnv } = TOKEN_ECONOMIZER_AGENT_CLIS[target.agent]
  for (const name of dropEnv) {
    delete env[name]
  }
  if (homeEnvVar) {
    env[homeEnvVar] = target.home ?? undefined
  }
  const result = await runProcess({
    program: target.executable,
    args,
    env,
    timeoutMs: AGENT_CLI_TIMEOUT_MS
  })
  if (result.code !== 0 || result.timedOut) {
    const output = (result.stderr.trim() || result.stdout.trim()).slice(-MAX_DETAIL_CHARS)
    throw new Error(`${target.agent} ${args.join(' ')} failed: ${output || 'no output'}`)
  }
  return result.stdout
}

async function findInstalledTargets(
  options: ApplyOptions,
  dataRoot: string
): Promise<{ targets: FoundTarget[]; failures: string[] }> {
  const presence = await detectLocalManagedAgentCliPresence(
    TOKEN_ECONOMIZER_AGENTS.map((agent) => ({
      agent,
      tuiAgent: agent,
      executableCandidates: getTuiAgentDetectCommands(TUI_AGENT_CONFIG[agent])
    })),
    options.settings,
    { shouldHydrateShellPath: options.shouldHydrateShellPath }
  )
  const targets: FoundTarget[] = []
  const failures: string[] = []
  for (const agent of TOKEN_ECONOMIZER_AGENTS) {
    const found = presence[agent]
    if (found?.state !== 'found') {
      continue
    }
    for (const home of listHomes(agent, dataRoot, options.settings)) {
      const target: FoundTarget = {
        agent,
        home,
        installed: false,
        executable: found.executablePath
      }
      try {
        const listOutput = await runAgentCli(target, TOKEN_ECONOMIZER_AGENT_CLIS[agent].listArgs)
        targets.push({
          ...target,
          installed: TOKEN_ECONOMIZER_AGENT_CLIS[agent].isInstalled(listOutput)
        })
      } catch (error) {
        failures.push(errorMessage(error))
      }
    }
  }
  return { targets, failures }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// TE prunes only tools it knows a session loads, and Claude does not log them; the catalog is per machine and goes stale on Claude updates.
async function refreshClaudeToolCatalog(
  python: readonly string[],
  cloneDir: string,
  claudeExecutable: string
): Promise<void> {
  const result = await runProcess({
    program: python[0],
    args: [
      ...python.slice(1),
      join(cloneDir, 'plugin', 'scripts', 'te_bootstrap.py'),
      'cli',
      '--host',
      'claude',
      'toolprune',
      'refresh-catalog'
    ],
    env: {
      ...process.env,
      PATH: `${dirname(claudeExecutable)}${delimiter}${process.env.PATH ?? ''}`
    },
    timeoutMs: AGENT_CLI_TIMEOUT_MS
  })
  if (result.code !== 0 || result.timedOut) {
    const output = (result.stderr.trim() || result.stdout.trim()).slice(-MAX_DETAIL_CHARS)
    throw new Error(`claude tool catalog refresh failed: ${output || 'no output'}`)
  }
}

async function runStep(
  target: FoundTarget,
  step: TokenEconomizerStep,
  dirs: { cloneDir: string; ompPackageDir: string }
): Promise<void> {
  switch (step.kind) {
    case 'cli':
      await runAgentCli(target, step.args)
      return
    case 'trust':
      await grantTokenEconomizerCodexTrust(
        target.executable,
        target.home ?? getSystemCodexHomePath()
      )
      return
    case 'write-package':
      await writeTokenEconomizerOmpPackage({
        packageDir: dirs.ompPackageDir,
        cloneDir: dirs.cloneDir,
        ompPath: target.executable
      })
      return
    case 'remove-package':
      await rm(dirs.ompPackageDir, { recursive: true, force: true })
  }
}

async function reconcile(enabled: boolean, options: ApplyOptions): Promise<TokenEconomizerStatus> {
  const dataRoot = getOrcaUserDataPath()
  const python = enabled ? await findTokenEconomizerPython() : null
  if (enabled) {
    if (!python) {
      return { state: 'python_missing' }
    }
    await ensureTokenEconomizerSource(dataRoot)
  }
  const { targets, failures } = await findInstalledTargets(options, dataRoot)
  const homes: string[] = []
  const cloneDir = getTokenEconomizerCloneDir(dataRoot)
  const ompPackageDir = getTokenEconomizerOmpPackageDir(dataRoot)
  const plan = planTokenEconomizer({ enabled, cloneDir, ompPackageDir, targets })
  for (const { target, steps } of plan) {
    try {
      for (const step of steps) {
        await runStep(target, step, { cloneDir, ompPackageDir })
      }
      homes.push(describeHome(target))
    } catch (error) {
      failures.push(errorMessage(error))
    }
  }
  const claude = targets.find((target) => target.agent === 'claude')
  if (python && claude) {
    try {
      await refreshClaudeToolCatalog(python, cloneDir, claude.executable)
    } catch (error) {
      failures.push(errorMessage(error))
    }
  }
  if (failures.length > 0) {
    return { state: 'error', detail: failures.join('; ').slice(0, MAX_DETAIL_CHARS), homes }
  }
  if (!enabled) {
    return { state: 'off' }
  }
  return homes.length > 0
    ? { state: 'installed', homes }
    : { state: 'error', detail: 'No Claude Code, Codex or omp CLI found on this machine.' }
}

let desired: { enabled: boolean; options: ApplyOptions } | null = null
let draining: Promise<void> | null = null

async function drain(): Promise<void> {
  try {
    while (desired) {
      const { enabled, options } = desired
      desired = null
      if (enabled) {
        setStatus({ state: 'installing' })
      }
      try {
        setStatus(await reconcile(enabled, options))
      } catch (error) {
        console.warn('[token-economizer] reconcile failed:', error)
        setStatus({ state: 'error', detail: errorMessage(error).slice(0, MAX_DETAIL_CHARS) })
      }
      console.info(`[token-economizer] ${enabled ? 'enable' : 'disable'} -> ${status.state}`)
    }
  } finally {
    draining = null
  }
}

/** Installs (or removes) TokenEconomizer in every local agent home; never throws. A call during a run re-runs after it. */
export function applyTokenEconomizerEnabled(
  enabled: boolean,
  options: ApplyOptions = {}
): Promise<void> {
  desired = { enabled, options }
  draining ??= drain()
  return draining
}

/** Installs at launch when the setting is on; never removes, since other Orca profiles may rely on it. */
export function reconcileStartupTokenEconomizer(host: {
  getSettings: () => Pick<
    GlobalSettings,
    'tokenEconomizerEnabled' | 'agentCmdOverrides' | 'codexManagedAccounts'
  >
  shouldHydrateShellPath: boolean
}): void {
  const settings = host.getSettings()
  if (settings.tokenEconomizerEnabled) {
    void applyTokenEconomizerEnabled(true, {
      settings,
      shouldHydrateShellPath: host.shouldHydrateShellPath
    })
  }
}
