import type { WorkspaceTimelineEntry } from './workspace-timeline-types'

/** Tie-break order for entries sharing one millisecond timestamp: a commit settles a turn
 *  that already showed as working, so it sorts after the agent activity that produced it;
 *  within agent activity a prompt precedes the state switch it caused, which precedes a
 *  file touched during that turn. */
const KIND_TIE_BREAK_ORDER: Record<WorkspaceTimelineEntry['kind'], number> = {
  commit: 0,
  prompt: 1,
  state: 2,
  file: 3
}

/** Merge-sorts persisted timeline entries (prompts/transitions/files) with the bounded
 *  commit list into one chronological feed, newest first. */
export function mergeWorkspaceTimelineEntries(
  persistedEntries: readonly WorkspaceTimelineEntry[],
  commitEntries: readonly WorkspaceTimelineEntry[]
): WorkspaceTimelineEntry[] {
  return [...persistedEntries, ...commitEntries].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return b.timestamp - a.timestamp
    }
    if (a.kind !== b.kind) {
      return KIND_TIE_BREAK_ORDER[a.kind] - KIND_TIE_BREAK_ORDER[b.kind]
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
  })
}
