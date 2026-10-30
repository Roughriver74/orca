import { translate } from '@/i18n/i18n'
import type { TokenEconomizerStatus } from '../../../../shared/token-economizer-status'
import { searchKeywords } from './settings-search-keywords'

export function getTokenEconomizerTitle(): string {
  return translate('settings.agents.tokenEconomizer.title', 'TokenEconomizer')
}

export function getTokenEconomizerDescription(): string {
  return translate(
    'settings.agents.tokenEconomizer.description',
    'Cuts token cost for Claude Code, Codex and omp. It learns per repository in ~/.tokeneconomizer and needs Python 3.10+. Turning it off removes the plugin and keeps what it learned.'
  )
}

/** The line under the switch; null when there is nothing to say. */
export function getTokenEconomizerStatusLine(status: TokenEconomizerStatus): string | null {
  switch (status.state) {
    case 'installing':
      return translate('settings.agents.tokenEconomizer.installing', 'Installing…')
    case 'installed':
      return translate(
        'settings.agents.tokenEconomizer.installed',
        'Installed (agent homes: {{count}}).',
        { count: status.homes?.length ?? 0 }
      )
    case 'python_missing':
      return translate(
        'settings.agents.tokenEconomizer.pythonMissing',
        'Python 3.10 or newer was not found. Install it, then turn this off and on again.'
      )
    case 'error':
      return translate('settings.agents.tokenEconomizer.error', 'Install failed: {{detail}}', {
        detail: status.detail ?? ''
      })
    case 'off':
      return null
  }
}

export function getTokenEconomizerSearchKeywords(): string[] {
  return searchKeywords([
    { key: 'settings.agents.tokenEconomizer.keywords.tokens', fallback: 'tokens' },
    { key: 'settings.agents.tokenEconomizer.keywords.cost', fallback: 'cost' },
    { key: 'settings.agents.tokenEconomizer.keywords.plugin', fallback: 'plugin' },
    {
      key: 'settings.agents.tokenEconomizer.keywords.python',
      fallback: 'python',
      englishOnly: true
    },
    {
      key: 'settings.agents.tokenEconomizer.keywords.claude',
      fallback: 'claude',
      englishOnly: true
    },
    { key: 'settings.agents.tokenEconomizer.keywords.codex', fallback: 'codex', englishOnly: true },
    { key: 'settings.agents.tokenEconomizer.keywords.omp', fallback: 'omp', englishOnly: true }
  ])
}
