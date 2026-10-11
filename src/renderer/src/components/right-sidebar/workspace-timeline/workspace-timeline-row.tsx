import React from 'react'
import { FileEdit, GitCommit, MessageSquare } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { basename } from '@/lib/path'
import type {
  WorkspaceTimelineCommitEntry,
  WorkspaceTimelineEntry,
  WorkspaceTimelineFileEntry
} from './workspace-timeline-types'

export function WorkspaceTimelineRow({
  entry,
  onOpenCommit,
  onOpenFile
}: {
  entry: WorkspaceTimelineEntry
  onOpenCommit: (entry: WorkspaceTimelineCommitEntry) => void
  onOpenFile: (entry: WorkspaceTimelineFileEntry) => void
}): React.JSX.Element {
  const time = new Date(entry.timestamp).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit'
  })

  if (entry.kind === 'prompt') {
    return (
      <div className="flex items-start gap-2 px-3 py-1.5 text-xs">
        <MessageSquare
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-foreground">{entry.text}</p>
          <span className="text-[10px] text-muted-foreground">{time}</span>
        </div>
      </div>
    )
  }

  if (entry.kind === 'state') {
    const label = entry.fromState
      ? `${agentStateLabel(entry.fromState)} → ${agentStateLabel(entry.state)}`
      : agentStateLabel(entry.state)
    return (
      <div className="flex items-center gap-2 px-3 py-1 text-xs">
        <AgentStateDot state={entry.state} size="sm" />
        <span className="min-w-0 flex-1 truncate text-foreground">{label}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
      </div>
    )
  }

  if (entry.kind === 'file') {
    return (
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-accent/40"
        onClick={() => onOpenFile(entry)}
      >
        <FileEdit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-foreground" title={entry.path}>
          {basename(entry.path)}
        </span>
        <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
      </button>
    )
  }

  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-accent/40"
      onClick={() => onOpenCommit(entry)}
    >
      <GitCommit className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-foreground">{entry.subject}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
    </button>
  )
}
