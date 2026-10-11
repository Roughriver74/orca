import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { WorkspaceCheckState } from '../../../../shared/workspace-check-types'
import { runWorkspaceCheck } from './workspace-check-rpc'

function CheckStatusBadge({ state }: { state: WorkspaceCheckState }): React.JSX.Element {
  if (state.status === 'running') {
    return (
      <Badge variant="outline">
        <Loader2 className="size-3 animate-spin" />
        {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.running', 'Running')}
      </Badge>
    )
  }
  if (state.status === 'passed') {
    return (
      <Badge variant="success">
        {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.passed', 'Passed')}
      </Badge>
    )
  }
  return (
    <Badge variant="destructive">
      {translate(
        'auto.components.sidebar.WorkspaceCheckOutputDialog.failedWithCode',
        'Failed (exit {{value0}})',
        { value0: state.exitCode ?? '—' }
      )}
    </Badge>
  )
}

export function WorkspaceCheckOutputDialog({
  worktreeId,
  state,
  open,
  onOpenChange
}: {
  worktreeId: string
  state: WorkspaceCheckState
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [isRunning, setIsRunning] = useState(false)

  const handleRunCheck = async (): Promise<void> => {
    setIsRunning(true)
    try {
      const nextState = await runWorkspaceCheck(worktreeId)
      useAppStore.getState().setWorkspaceCheckState(worktreeId, nextState)
    } finally {
      setIsRunning(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.title', 'Check Command')}
          </DialogTitle>
          <DialogDescription asChild>
            <code className="block rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
              {state.command}
            </code>
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckStatusBadge state={state} />
            {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isRunning || state.status === 'running'}
            onClick={() => void handleRunCheck()}
          >
            {isRunning || state.status === 'running' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.runCheck', 'Run check')}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">
              {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.stdout', 'stdout')}
            </p>
            <div className="h-48 rounded-md border border-border bg-muted/20">
              <ScrollArea className="h-full">
                <pre className="whitespace-pre-wrap break-words p-2 font-mono text-xs">
                  {state.stdout}
                  {state.stdoutTruncated
                    ? `\n${translate('auto.components.sidebar.WorkspaceCheckOutputDialog.truncated', '… truncated')}`
                    : ''}
                </pre>
              </ScrollArea>
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground">
              {translate('auto.components.sidebar.WorkspaceCheckOutputDialog.stderr', 'stderr')}
            </p>
            <div className="h-48 rounded-md border border-border bg-muted/20">
              <ScrollArea className="h-full">
                <pre className="whitespace-pre-wrap break-words p-2 font-mono text-xs">
                  {state.stderr}
                  {state.stderrTruncated
                    ? `\n${translate('auto.components.sidebar.WorkspaceCheckOutputDialog.truncated', '… truncated')}`
                    : ''}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
