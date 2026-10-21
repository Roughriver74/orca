import { buildAgentPromptPasteBytes } from '../../../../shared/agent-prompt-injection'
import { expandPromptSnippet } from '../../../../shared/prompt-snippet-variables'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  buildPromptSnippetVariableContext,
  resolvePromptSnippetClipboardVariable
} from './prompt-snippet-variable-context'
import {
  resolvePromptLibraryInsertTarget,
  type PromptLibraryInsertTarget
} from './resolve-prompt-library-insert-target'

export type InsertPromptSnippetResult = { status: 'inserted' } | { status: 'no-target' }

/** Minimal shape `expandPromptSnippetForTarget` needs: the worktree whose variables
 *  (branch, changed files, check state, overlap…) apply, and the pane whose
 *  `{lastAgentMessage}` applies — distinct because a chip targets its own pane. */
export type PromptSnippetExpansionTarget = { worktreeId: string; paneKey: string | null }

function toExpansionTarget(target: PromptLibraryInsertTarget): PromptSnippetExpansionTarget {
  return { worktreeId: target.worktreeId, paneKey: `${target.tabId}:${target.leafId}` }
}

/** Expands `body`'s variables against live app state for `target` (or the active
 *  worktree, with no pane-scoped variables, when omitted). Shared by paste-into-pty
 *  and queue-for-later, which both need the same expansion without a pty write. */
export async function expandPromptSnippetForTarget(
  body: string,
  target: PromptSnippetExpansionTarget | null
): Promise<string> {
  const state = useAppStore.getState()
  const worktreeId = target?.worktreeId ?? state.activeWorktreeId
  const worktree = worktreeId ? (findWorktreeById(state.worktreesByRepo, worktreeId) ?? null) : null
  const repoDisplayName = worktree
    ? (state.repos.find((r) => r.id === worktree.repoId)?.displayName ?? null)
    : null
  const context = buildPromptSnippetVariableContext(
    state,
    worktree,
    repoDisplayName,
    target?.paneKey ?? null
  )
  context.clipboard = await resolvePromptSnippetClipboardVariable(body)
  return expandPromptSnippet(body, context).text
}

/** Expands `body`'s variables against live app state and pastes the result (bracketed,
 *  no Enter) into the pty backing `target` (or the focused agent terminal / native chat
 *  composer when omitted) — a chip click targets its own pane even if focus is elsewhere. */
export async function insertPromptSnippetIntoTarget(
  body: string,
  target?: PromptLibraryInsertTarget
): Promise<InsertPromptSnippetResult> {
  const state = useAppStore.getState()
  const resolved = target ?? resolvePromptLibraryInsertTarget(state)
  if (!resolved) {
    return { status: 'no-target' }
  }
  const text = await expandPromptSnippetForTarget(body, toExpansionTarget(resolved))
  sendRuntimePtyInput(resolved.ptyId, buildAgentPromptPasteBytes(text), 'driving')
  return { status: 'inserted' }
}
