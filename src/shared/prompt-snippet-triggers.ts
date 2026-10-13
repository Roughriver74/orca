import type { PromptSnippetTrigger } from './prompt-snippet-types'

/** Minimal slice of an agent-status row the evaluator needs. */
export type PromptSnippetTriggerAgentStatus = {
  state: 'working' | 'blocked' | 'waiting' | 'done'
  interrupted?: boolean
}

/** Minimal slice of a workspace check state the evaluator needs. */
export type PromptSnippetTriggerCheckState = {
  status: 'running' | 'passed' | 'failed'
}

export type PromptSnippetTriggerEvaluationInput = {
  agentStatus: PromptSnippetTriggerAgentStatus | null
  checkState: PromptSnippetTriggerCheckState | null
  hasLinkedWorkItem: boolean
  changedPaths: readonly string[]
  /** Non-empty when this worktree's changed files intersect a sibling worktree's. */
  overlappingSiblingPaths: readonly string[]
}

/** Pure: given a pane/worktree's live facts, returns the set of triggers currently true.
 *  `agentDone` requires a normal completion — an interrupted `done` does not count, matching
 *  how the rest of the app treats an interrupt as "stopped", not "finished". */
export function evaluatePromptSnippetTriggers(
  input: PromptSnippetTriggerEvaluationInput
): Set<PromptSnippetTrigger> {
  const triggers = new Set<PromptSnippetTrigger>()
  if (input.checkState?.status === 'failed') {
    triggers.add('checkFailed')
  }
  if (input.overlappingSiblingPaths.length > 0) {
    triggers.add('overlap')
  }
  if (input.agentStatus?.state === 'done' && input.agentStatus.interrupted !== true) {
    triggers.add('agentDone')
  }
  if (input.hasLinkedWorkItem) {
    triggers.add('hasIssue')
  }
  if (input.changedPaths.length > 0) {
    triggers.add('hasChanges')
  }
  return triggers
}

/** True when every trigger the snippet lists is present in `activeTriggers`; a snippet
 *  with no `when` (or an empty one) is never suggested as a chip. */
export function promptSnippetTriggersSatisfied(
  when: readonly PromptSnippetTrigger[] | undefined,
  activeTriggers: ReadonlySet<PromptSnippetTrigger>
): boolean {
  if (!when || when.length === 0) {
    return false
  }
  return when.every((trigger) => activeTriggers.has(trigger))
}
