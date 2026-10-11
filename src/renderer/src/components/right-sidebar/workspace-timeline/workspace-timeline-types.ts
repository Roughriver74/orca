import type { AgentStatusState, AgentType } from '../../../../../shared/agent-status-types'

/** A user prompt that started (or restarted) an agent's turn. */
export type WorkspaceTimelinePromptEntry = {
  kind: 'prompt'
  id: string
  worktreeId: string
  paneKey: string
  agentType: AgentType
  timestamp: number
  text: string
}

/** An agent pane settling into a new state (working/blocked/waiting/done). */
export type WorkspaceTimelineStateEntry = {
  kind: 'state'
  id: string
  worktreeId: string
  paneKey: string
  agentType: AgentType
  timestamp: number
  state: AgentStatusState
  /** Null when this is the first state observed for the pane this session. */
  fromState: AgentStatusState | null
}

/** A file touched by an edit/write tool call, derived from the live hook tool fields. */
export type WorkspaceTimelineFileEntry = {
  kind: 'file'
  id: string
  worktreeId: string
  paneKey: string
  agentType: AgentType
  timestamp: number
  path: string
  toolName: string
}

/** A commit from the bounded `git log`, read fresh from the execution host on each visit. */
export type WorkspaceTimelineCommitEntry = {
  kind: 'commit'
  id: string
  worktreeId: string
  timestamp: number
  commitId: string
  displayId?: string
  subject: string
  message: string
  author?: string
}

/** Entries persisted to local storage; commits are never persisted since `git log` already is durable. */
export type WorkspaceTimelinePersistedEntry =
  | WorkspaceTimelinePromptEntry
  | WorkspaceTimelineStateEntry
  | WorkspaceTimelineFileEntry

export type WorkspaceTimelineEntry = WorkspaceTimelinePersistedEntry | WorkspaceTimelineCommitEntry

/** Bounds the persisted (non-git) history kept per workspace; oldest entries drop first. */
export const WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE = 300
/** Bounds how many workspaces' timelines stay in local storage; the least-recently-touched is evicted first. */
export const WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES = 40
/** Bounded `git log` page size merged into the timeline. */
export const WORKSPACE_TIMELINE_COMMIT_LIMIT = 50
