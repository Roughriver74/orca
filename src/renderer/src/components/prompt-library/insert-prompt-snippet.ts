import { buildAgentPromptPasteBytes } from '../../../../shared/agent-prompt-injection'
import { expandPromptSnippet } from '../../../../shared/prompt-snippet-variables'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  buildPromptSnippetVariableContext,
  resolvePromptSnippetClipboardVariable
} from './prompt-snippet-variable-context'
import { resolvePromptLibraryInsertTarget } from './resolve-prompt-library-insert-target'

export type InsertPromptSnippetResult = { status: 'inserted' } | { status: 'no-target' }

/** Expands `body`'s variables against live app state and pastes the result (bracketed,
 *  no Enter) into the pty backing the focused agent terminal / native chat composer. */
export async function insertPromptSnippetIntoFocusedTarget(
  body: string
): Promise<InsertPromptSnippetResult> {
  const state = useAppStore.getState()
  const target = resolvePromptLibraryInsertTarget(state)
  if (!target) {
    return { status: 'no-target' }
  }
  const worktree = state.activeWorktreeId
    ? (findWorktreeById(state.worktreesByRepo, state.activeWorktreeId) ?? null)
    : null
  const repoDisplayName = worktree
    ? (state.repos.find((r) => r.id === worktree.repoId)?.displayName ?? null)
    : null
  const context = buildPromptSnippetVariableContext(state, worktree, repoDisplayName)
  context.clipboard = await resolvePromptSnippetClipboardVariable(body)
  const { text } = expandPromptSnippet(body, context)
  sendRuntimePtyInput(state.settings, target.ptyId, buildAgentPromptPasteBytes(text), 'driving')
  return { status: 'inserted' }
}
