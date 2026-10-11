import * as monaco from 'monaco-editor'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import {
  listReferencedPromptSnippetVariables,
  type PromptSnippetVariableContext
} from '../../../../shared/prompt-snippet-variables'
import type { AppState } from '@/store/types'
import type { Tab } from '../../../../shared/tab-types'
import type { Worktree } from '../../../../shared/worktree/types'

/** The open file tab this worktree's user looked at most recently, editor-focused or not —
 *  "active editor file" survives a focus move to the terminal, matching how a human reads it. */
function findMostRecentEditorTab(tabs: readonly Tab[]): Tab | null {
  let best: Tab | null = null
  for (const tab of tabs) {
    if (tab.contentType !== 'editor') {
      continue
    }
    if (!best || (tab.lastFocusedAt ?? 0) > (best.lastFocusedAt ?? 0)) {
      best = tab
    }
  }
  return best
}

/** Best-effort: Monaco keeps editor instances mounted for recently-viewed tabs even while
 *  hidden, so a selection can still be read after focus moved to the terminal. */
function getMountedEditorSelectionText(absoluteFilePath: string): string {
  for (const editor of monaco.editor.getEditors()) {
    const model = editor.getModel()
    if (!model || model.uri.path !== absoluteFilePath) {
      continue
    }
    const selection = editor.getSelection()
    if (!selection || selection.isEmpty()) {
      continue
    }
    return model.getValueInRange(selection)
  }
  return ''
}

function formatLinkedIssue(worktree: Worktree | null): string {
  const item = worktree?.linkedWorkItem
  if (!item?.title) {
    return ''
  }
  return item.url ? `${item.title} (${item.url})` : item.title
}

/** Builds the sync part of the variable context: everything except `{clipboard}`,
 *  which needs an async IPC round trip and is only worth paying for when referenced. */
export function buildPromptSnippetVariableContext(
  state: Pick<AppState, 'unifiedTabsByWorktree'>,
  worktree: Worktree | null,
  repoDisplayName: string | null
): PromptSnippetVariableContext {
  const context: PromptSnippetVariableContext = {
    branch: worktree?.branch ?? '',
    worktree: worktree?.path ?? '',
    repo: repoDisplayName ?? '',
    issue: formatLinkedIssue(worktree)
  }
  const editorTab = worktree
    ? findMostRecentEditorTab(state.unifiedTabsByWorktree[worktree.id] ?? [])
    : null
  if (editorTab && worktree) {
    const relativePath = relativePathInsideRoot(worktree.path, editorTab.entityId)
    context.file = relativePath ?? editorTab.entityId
    context.selection = getMountedEditorSelectionText(editorTab.entityId)
  }
  return context
}

/** Only reads the clipboard when the snippet body actually references `{clipboard}`. */
export async function resolvePromptSnippetClipboardVariable(body: string): Promise<string> {
  if (!listReferencedPromptSnippetVariables(body).includes('clipboard')) {
    return ''
  }
  try {
    return await window.api.ui.readClipboardText()
  } catch {
    return ''
  }
}
