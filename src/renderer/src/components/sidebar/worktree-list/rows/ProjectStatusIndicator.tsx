import React from 'react'
import StatusIndicator from '../../StatusIndicator'
import { useWorktreeActivityStatuses } from '../../use-worktree-activity-statuses'
import { rollUpProjectStatus } from './project-status-rollup'

export const ProjectStatusIndicator = React.memo(function ProjectStatusIndicator({
  worktreeIds
}: {
  worktreeIds: readonly string[]
}): React.JSX.Element | null {
  const status = rollUpProjectStatus(useWorktreeActivityStatuses(worktreeIds))
  if (!status) {
    return null
  }
  return <StatusIndicator status={status} data-project-status="" />
})
