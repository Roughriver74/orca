import {
  evaluatePromptSnippetTriggers,
  promptSnippetTriggersSatisfied
} from '../../../../shared/prompt-snippet-triggers'
import type { PromptSnippet } from '../../../../shared/prompt-snippet-types'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { getOverlapRadarMatchesFromState } from '@/store/overlap-radar-selectors'
import type { AppState } from '@/store/types'

/** Suggestion chips never show more than this many at once — a terminal pane is small,
 *  and a long chip row would compete with the terminal for space. */
export const AGENT_CONTEXT_PROMPT_CHIPS_MAX = 4

export type AgentContextPromptChipSelectionState = Pick<
  AppState,
  | 'agentStatusByPaneKey'
  | 'workspaceCheckStateByWorktreeId'
  | 'overlapRadarChangedPathsByWorktree'
  | 'worktreesByRepo'
  | 'settings'
>

/** Settings + repo snippets whose `when` triggers all hold for `paneKey`/`worktreeId`,
 *  settings-defined snippets first (by sortOrder), then repo prompts, capped at
 *  AGENT_CONTEXT_PROMPT_CHIPS_MAX. */
export function selectAgentContextPromptChips(
  state: AgentContextPromptChipSelectionState,
  paneKey: string,
  worktreeId: string,
  repoSnippets: readonly PromptSnippet[]
): PromptSnippet[] {
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId) ?? null
  const agentStatus = state.agentStatusByPaneKey[paneKey]
  const checkState = state.workspaceCheckStateByWorktreeId[worktreeId]
  const overlapPeers = getOverlapRadarMatchesFromState(state)[worktreeId] ?? []
  const triggers = evaluatePromptSnippetTriggers({
    agentStatus: agentStatus ? { state: agentStatus.state, interrupted: agentStatus.interrupted } : null,
    checkState: checkState ? { status: checkState.status } : null,
    hasLinkedWorkItem: Boolean(worktree?.linkedWorkItem),
    changedPaths: state.overlapRadarChangedPathsByWorktree[worktreeId] ?? [],
    overlappingSiblingPaths: overlapPeers.flatMap((peer) => peer.files.map((file) => file.path))
  })
  const bySortOrder = (a: PromptSnippet, b: PromptSnippet): number =>
    a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  const settingsMatches = (state.settings?.promptLibrarySnippets ?? [])
    .filter((snippet) => promptSnippetTriggersSatisfied(snippet.when, triggers))
    .sort(bySortOrder)
  const repoMatches = repoSnippets
    .filter((snippet) => promptSnippetTriggersSatisfied(snippet.when, triggers))
    .sort(bySortOrder)
  return [...settingsMatches, ...repoMatches].slice(0, AGENT_CONTEXT_PROMPT_CHIPS_MAX)
}
