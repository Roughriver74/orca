import React from 'react'
import { Coins } from 'lucide-react'
import type { WorkspaceUsageToday } from '../../../../shared/workspace-usage-types'
import { formatUsageCost, formatUsageTokens } from '../stats/usage-overview-model'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { translate } from '@/i18n/i18n'

type WorktreeCardUsageProps = {
  usage: WorkspaceUsageToday
}

const PROVIDER_LABEL: Record<WorkspaceUsageToday['providers'][number]['provider'], string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

function formatCompactUsage(usage: WorkspaceUsageToday): string {
  const tokens = formatUsageTokens(usage.totalTokens)
  const cost = formatUsageCost(usage.estimatedCostUsd)
  return usage.estimatedCostUsd === null ? `${tokens} tokens` : `${tokens} tokens · ${cost}`
}

export function WorktreeCardUsageTrigger({
  usage
}: WorktreeCardUsageProps): React.JSX.Element | null {
  if (usage.providers.length === 0) {
    return null
  }

  return (
    <button
      type="button"
      className="inline-flex size-3.5 shrink-0 items-center justify-center rounded text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
      aria-label={translate(
        'auto.components.sidebar.WorktreeCardUsage.triggerAriaLabel',
        'Today\u2019s usage: {{value0}}',
        { value0: formatCompactUsage(usage) }
      )}
      onClick={(event) => event.stopPropagation()}
    >
      <Coins className="size-3.5" />
    </button>
  )
}

export function WorktreeCardUsageDetails({
  usage
}: WorktreeCardUsageProps): React.JSX.Element | null {
  if (usage.providers.length === 0) {
    return null
  }

  return (
    <WorktreeCardDetailSection>
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <Coins className="size-3" />
        <span>
          {translate('auto.components.sidebar.WorktreeCardUsage.sectionTitle', 'Usage Today')}
        </span>
      </div>
      <WorktreeCardDetailSectionContent className="space-y-1">
        <div className="text-[13px] font-semibold leading-snug text-foreground">
          {formatCompactUsage(usage)}
          {usage.hasPartialCost && (
            <span className="ml-1 font-normal text-muted-foreground">
              {translate(
                'auto.components.sidebar.WorktreeCardUsage.partialCostSuffix',
                '(partial — some models unpriced)'
              )}
            </span>
          )}
        </div>
        {usage.providers.map((provider) => (
          <div
            key={provider.provider}
            className="flex items-center justify-between text-[11.5px] leading-snug text-muted-foreground"
          >
            <span>{PROVIDER_LABEL[provider.provider]}</span>
            <span className="tabular-nums">
              {formatUsageTokens(provider.totalTokens)} ·{' '}
              {formatUsageCost(provider.estimatedCostUsd)}
            </span>
          </div>
        ))}
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
