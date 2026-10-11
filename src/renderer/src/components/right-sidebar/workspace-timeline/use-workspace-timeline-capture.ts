import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { useWorkspaceTimelineStore } from '@/store/workspace-timeline-store'
import { EDIT_TOOL_NAMES } from '../../../../../shared/native-chat-diff'
import type { AgentStatusState } from '../../../../../shared/agent-status-types'
import type {
  WorkspaceTimelineFileEntry,
  WorkspaceTimelinePersistedEntry,
  WorkspaceTimelinePromptEntry,
  WorkspaceTimelineStateEntry
} from './workspace-timeline-types'

type CapturedPaneSnapshot = {
  state: AgentStatusState
  stateStartedAt: number
  prompt: string
  toolSignature: string | null
}

/** Mirrors live agent-status hook events into the per-workspace timeline: a state switch
 *  becomes a `state` entry, a fresh prompt starting a `working` state becomes a `prompt`
 *  entry, and an edit/write tool call becomes a `file` entry. Mounted once at app-shell
 *  level so a background workspace is still captured while the Timeline tab isn't open.
 *  The first observation of each pane only records a baseline (no entry) — otherwise every
 *  pane already open at launch would replay its current state as a "new" transition. */
export function useWorkspaceTimelineCapture(): void {
  const agentStatusByPaneKey = useAppStore((s) => s.agentStatusByPaneKey)
  const appendEntries = useWorkspaceTimelineStore((s) => s.appendEntries)
  const snapshotByPaneKeyRef = useRef(new Map<string, CapturedPaneSnapshot>())

  useEffect(() => {
    const snapshots = snapshotByPaneKeyRef.current
    const entriesByWorktreeId: Record<string, WorkspaceTimelinePersistedEntry[]> = {}

    for (const [paneKey, entry] of Object.entries(agentStatusByPaneKey)) {
      const worktreeId = entry.worktreeId
      if (!worktreeId) {
        continue
      }
      const agentType = entry.agentType ?? 'unknown'
      const toolName = entry.toolName
      const toolInput = entry.toolInput
      const toolSignature =
        toolName && toolInput && EDIT_TOOL_NAMES.has(toolName) ? `${toolName}:${toolInput}` : null
      const previous = snapshots.get(paneKey)

      if (!previous) {
        snapshots.set(paneKey, {
          state: entry.state,
          stateStartedAt: entry.stateStartedAt,
          prompt: entry.prompt,
          toolSignature
        })
        continue
      }

      const list = entriesByWorktreeId[worktreeId] ?? []
      if (previous.stateStartedAt !== entry.stateStartedAt) {
        if (entry.state === 'working' && entry.prompt && entry.prompt !== previous.prompt) {
          const promptEntry: WorkspaceTimelinePromptEntry = {
            kind: 'prompt',
            id: `${paneKey}:prompt:${entry.stateStartedAt}`,
            worktreeId,
            paneKey,
            agentType,
            timestamp: entry.stateStartedAt,
            text: entry.prompt
          }
          list.push(promptEntry)
        }
        const stateEntry: WorkspaceTimelineStateEntry = {
          kind: 'state',
          id: `${paneKey}:state:${entry.stateStartedAt}`,
          worktreeId,
          paneKey,
          agentType,
          timestamp: entry.stateStartedAt,
          state: entry.state,
          fromState: previous.state
        }
        list.push(stateEntry)
      }
      if (toolSignature && toolSignature !== previous.toolSignature && toolName && toolInput) {
        const fileEntry: WorkspaceTimelineFileEntry = {
          kind: 'file',
          id: `${paneKey}:file:${entry.updatedAt}`,
          worktreeId,
          paneKey,
          agentType,
          timestamp: entry.updatedAt,
          path: toolInput,
          toolName
        }
        list.push(fileEntry)
      }
      if (list.length > 0) {
        entriesByWorktreeId[worktreeId] = list
      }

      snapshots.set(paneKey, {
        state: entry.state,
        stateStartedAt: entry.stateStartedAt,
        prompt: entry.prompt,
        toolSignature
      })
    }

    for (const paneKey of snapshots.keys()) {
      if (!(paneKey in agentStatusByPaneKey)) {
        snapshots.delete(paneKey)
      }
    }

    for (const [worktreeId, entries] of Object.entries(entriesByWorktreeId)) {
      appendEntries(worktreeId, entries)
    }
  }, [agentStatusByPaneKey, appendEntries])
}
