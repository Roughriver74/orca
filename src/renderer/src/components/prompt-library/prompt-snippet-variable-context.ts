import * as monaco from 'monaco-editor'
import { relativePathInsideRoot } from '../../../../shared/cross-platform-path'
import {
  listReferencedPromptSnippetVariables,
  type PromptSnippetVariableContext
} from '../../../../shared/prompt-snippet-variables'
import { getOverlapRadarMatchesFromState } from '@/store/overlap-radar-selectors'
import { branchName } from '@/lib/git-utils'
import type { AppState } from '@/store/types'
import type { Tab } from '../../../../shared/tab-types'
import type { Worktree } from '../../../../shared/worktree/types'

/** Caps how many changed-file lines `{changedFiles}` and `{overlap}` include — a prompt
 *  body should get a scannable list, not an entire refactor's file manifest. */
const CHANGED_FILES_VARIABLE_MAX_LINES = 50
/** `{checkOutput}` tail length; enough for the error itself without flooding the prompt. */
const CHECK_OUTPUT_VARIABLE_MAX_CHARS = 4000

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

function formatChangedFilesVariable(paths: readonly string[]): string {
  return paths.slice(0, CHANGED_FILES_VARIABLE_MAX_LINES).join('\n')
}

function formatCheckOutputVariable(stdout: string, stderr: string): string {
  const combined = [stderr, stdout].filter((part) => part.trim().length > 0).join('\n')
  return combined.length > CHECK_OUTPUT_VARIABLE_MAX_CHARS
    ? combined.slice(-CHECK_OUTPUT_VARIABLE_MAX_CHARS)
    : combined
}

function formatOverlapVariable(
  state: Pick<AppState, 'worktreesByRepo' | 'overlapRadarChangedPathsByWorktree'>,
  worktreeId: string
): string {
  const peers = getOverlapRadarMatchesFromState(state)[worktreeId] ?? []
  return peers
    .map((peer) => `${peer.displayName}: ${peer.files.map((file) => file.path).join(', ')}`)
    .join('\n')
}

/** Builds the sync part of the variable context: everything except `{clipboard}`,
 *  which needs an async IPC round trip and is only worth paying for when referenced.
 *  `targetPaneKey` is the pane the prompt will land in — not necessarily the focused one
 *  (a chip click targets its own pane) — and drives `{lastAgentMessage}`. */
export function buildPromptSnippetVariableContext(
  state: Pick<
    AppState,
    | 'unifiedTabsByWorktree'
    | 'agentStatusByPaneKey'
    | 'workspaceCheckStateByWorktreeId'
    | 'overlapRadarChangedPathsByWorktree'
    | 'worktreesByRepo'
  >,
  worktree: Worktree | null,
  repoDisplayName: string | null,
  targetPaneKey: string | null
): PromptSnippetVariableContext {
  const checkState = worktree ? (state.workspaceCheckStateByWorktreeId[worktree.id] ?? null) : null
  const context: PromptSnippetVariableContext = {
    branch: worktree?.branch ? branchName(worktree.branch) : '',
    worktree: worktree?.path ?? '',
    repo: repoDisplayName ?? '',
    issue: formatLinkedIssue(worktree),
    changedFiles: worktree
      ? formatChangedFilesVariable(state.overlapRadarChangedPathsByWorktree[worktree.id] ?? [])
      : '',
    checkCommand: checkState?.command ?? '',
    checkOutput:
      checkState?.status === 'failed' ? formatCheckOutputVariable(checkState.stdout, checkState.stderr) : '',
    lastAgentMessage: targetPaneKey
      ? (state.agentStatusByPaneKey[targetPaneKey]?.lastCompletedAssistantMessage ?? '')
      : '',
    overlap: worktree ? formatOverlapVariable(state, worktree.id) : ''
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
