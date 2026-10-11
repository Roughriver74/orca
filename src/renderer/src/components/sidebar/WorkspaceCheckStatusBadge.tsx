import { useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useWorkspaceCheckState } from './use-workspace-check-state'
import { WorkspaceCheckOutputDialog } from './WorkspaceCheckOutputDialog'

export function WorkspaceCheckStatusBadge({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const [dialogOpen, setDialogOpen] = useState(false)
  const state = useWorkspaceCheckState(worktreeId)

  if (!state) {
    return null
  }

  const statusLabel =
    state.status === 'running'
      ? translate('auto.components.sidebar.WorkspaceCheckStatusBadge.running', 'Running')
      : state.status === 'passed'
        ? translate('auto.components.sidebar.WorkspaceCheckStatusBadge.passed', 'Passed')
        : translate('auto.components.sidebar.WorkspaceCheckStatusBadge.failed', 'Failed')
  const tooltip =
    state.status === 'failed'
      ? translate(
          'auto.components.sidebar.WorkspaceCheckStatusBadge.tooltipFailed',
          '{{value0}} · {{value1}} · exit {{value2}}',
          { value0: state.command, value1: statusLabel, value2: state.exitCode ?? '—' }
        )
      : translate(
          'auto.components.sidebar.WorkspaceCheckStatusBadge.tooltip',
          '{{value0}} · {{value1}}',
          { value0: state.command, value1: statusLabel }
        )

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setDialogOpen(true)
            }}
            aria-label={statusLabel}
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-full',
              'hover:bg-accent/80'
            )}
          >
            {state.status === 'running' ? (
              <Loader2 className="size-3 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : state.status === 'passed' ? (
              <CheckCircle2 className="size-3 text-status-success" aria-hidden="true" />
            ) : (
              <XCircle className="size-3 text-destructive" aria-hidden="true" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          <span>{tooltip}</span>
        </TooltipContent>
      </Tooltip>
      {dialogOpen ? (
        <WorkspaceCheckOutputDialog
          worktreeId={worktreeId}
          state={state}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      ) : null}
    </>
  )
}
