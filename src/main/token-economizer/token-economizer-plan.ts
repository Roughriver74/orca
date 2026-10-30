import { TOKEN_ECONOMIZER_OMP_PACKAGE } from './token-economizer-omp-package'

export const TOKEN_ECONOMIZER_MARKETPLACE = 'tokeneconomizer'
export const TOKEN_ECONOMIZER_PLUGIN_ID = 'tokeneconomizer@tokeneconomizer'

export const TOKEN_ECONOMIZER_AGENTS = ['claude', 'codex', 'omp'] as const
export type TokenEconomizerAgent = (typeof TOKEN_ECONOMIZER_AGENTS)[number]

type AgentPluginCli = {
  /** Env var that points the agent CLI at one config home; null when the agent has a single home. */
  homeEnvVar: string | null
  /** Inherited env vars that would redirect the CLI to another profile. */
  dropEnv: readonly string[]
  listArgs: string[]
  isInstalled: (listOutput: string) => boolean
  installArgs: (dirs: { cloneDir: string; ompPackageDir: string }) => string[][]
  removeArgs: string[][]
  /** The agent ignores plugin hooks until they are trusted. */
  needsHookTrust: boolean
  /** Installs a generated wrapper package that is rewritten on every enable and deleted on removal. */
  usesOrcaPackage: boolean
}

// A new agent joins by adding its name to TOKEN_ECONOMIZER_AGENTS and its entry here.
export const TOKEN_ECONOMIZER_AGENT_CLIS: Record<TokenEconomizerAgent, AgentPluginCli> = {
  claude: {
    homeEnvVar: 'CLAUDE_CONFIG_DIR',
    dropEnv: [],
    listArgs: ['plugin', 'list', '--json'],
    isInstalled: (listOutput) => {
      const plugins: unknown = JSON.parse(listOutput)
      return (
        Array.isArray(plugins) &&
        plugins.some((plugin) => plugin?.id === TOKEN_ECONOMIZER_PLUGIN_ID)
      )
    },
    installArgs: ({ cloneDir }) => [
      ['plugin', 'marketplace', 'add', cloneDir],
      ['plugin', 'install', TOKEN_ECONOMIZER_PLUGIN_ID]
    ],
    // Uninstall fails when the plugin is absent, so removal is only planned for installed homes.
    removeArgs: [
      ['plugin', 'uninstall', TOKEN_ECONOMIZER_PLUGIN_ID],
      ['plugin', 'marketplace', 'remove', TOKEN_ECONOMIZER_MARKETPLACE]
    ],
    needsHookTrust: false,
    usesOrcaPackage: false
  },
  codex: {
    homeEnvVar: 'CODEX_HOME',
    dropEnv: [],
    listArgs: ['plugin', 'list'],
    isInstalled: (listOutput) =>
      new RegExp(`^\\s*${TOKEN_ECONOMIZER_PLUGIN_ID}\\s+installed\\b`, 'm').test(listOutput),
    installArgs: ({ cloneDir }) => [
      ['plugin', 'marketplace', 'add', cloneDir],
      ['plugin', 'add', TOKEN_ECONOMIZER_PLUGIN_ID]
    ],
    removeArgs: [
      ['plugin', 'remove', TOKEN_ECONOMIZER_PLUGIN_ID],
      ['plugin', 'marketplace', 'remove', TOKEN_ECONOMIZER_MARKETPLACE]
    ],
    needsHookTrust: true,
    usesOrcaPackage: false
  },
  omp: {
    homeEnvVar: null,
    // Only the default omp profile is targeted.
    dropEnv: ['OMP_PROFILE'],
    listArgs: ['plugin', 'list', '--json'],
    isInstalled: (listOutput) => {
      const plugins: unknown = JSON.parse(listOutput)
      const npm =
        typeof plugins === 'object' && plugins !== null && 'npm' in plugins ? plugins.npm : null
      return (
        Array.isArray(npm) && npm.some((plugin) => plugin?.name === TOKEN_ECONOMIZER_OMP_PACKAGE)
      )
    },
    installArgs: ({ ompPackageDir }) => [['plugin', 'install', ompPackageDir]],
    removeArgs: [['plugin', 'uninstall', TOKEN_ECONOMIZER_OMP_PACKAGE]],
    needsHookTrust: false,
    usesOrcaPackage: true
  }
}

export type TokenEconomizerTarget = {
  agent: TokenEconomizerAgent
  /** Config home passed through the agent's env var; null keeps the agent's own default. */
  home: string | null
  installed: boolean
}

export type TokenEconomizerStep =
  | { kind: 'cli'; args: string[] }
  | { kind: 'trust' }
  | { kind: 'write-package' }
  | { kind: 'remove-package' }

export type TokenEconomizerPlan<T extends TokenEconomizerTarget> = {
  target: T
  steps: TokenEconomizerStep[]
}[]

const cliSteps = (commands: string[][]): TokenEconomizerStep[] =>
  commands.map((args) => ({ kind: 'cli', args }))

/** Ordered steps per target; enabling an installed home only refreshes generated files and re-grants hook trust. */
export function planTokenEconomizer<T extends TokenEconomizerTarget>(input: {
  enabled: boolean
  cloneDir: string
  ompPackageDir: string
  targets: readonly T[]
}): TokenEconomizerPlan<T> {
  return input.targets.map((target) => {
    const cli = TOKEN_ECONOMIZER_AGENT_CLIS[target.agent]
    const steps: TokenEconomizerStep[] = []
    if (input.enabled) {
      if (cli.usesOrcaPackage) {
        steps.push({ kind: 'write-package' })
      }
      if (!target.installed) {
        steps.push(...cliSteps(cli.installArgs(input)))
      }
      if (cli.needsHookTrust) {
        steps.push({ kind: 'trust' })
      }
    } else if (target.installed) {
      steps.push(...cliSteps(cli.removeArgs))
      if (cli.usesOrcaPackage) {
        steps.push({ kind: 'remove-package' })
      }
    }
    return { target, steps }
  })
}
