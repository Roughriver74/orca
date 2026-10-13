import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { sendNotesToActiveAgentSession } from '@/lib/active-agent-note-send'
import { findWorktreeById, getRepoIdFromWorktreeId } from '@/store/slices/worktree-helpers'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import type { WorkspaceCheckState } from '../../../../shared/workspace-check-types'
import { translate } from '@/i18n/i18n'
import {
  buildWorkspaceCheckAutoFixPrompt,
  decideWorkspaceCheckAutoFix,
  type WorkspaceCheckAutoFixAgentPane
} from './workspace-check-auto-fix-decision'

type WorktreeAutoFixProgress = {
  lastProcessedFinishedAt: number | null
  attemptCount: number
  limitToastShown: boolean
}

// Why module-level, not store state: this is retry bookkeeping for a background
// subscriber, not UI-visible app state — nothing reads or persists it.
const progressByWorktreeId = new Map<string, WorktreeAutoFixProgress>()

function getProgress(worktreeId: string): WorktreeAutoFixProgress {
  let progress = progressByWorktreeId.get(worktreeId)
  if (!progress) {
    progress = { lastProcessedFinishedAt: null, attemptCount: 0, limitToastShown: false }
    progressByWorktreeId.set(worktreeId, progress)
  }
  return progress
}

function collectAgentPanes(
  state: AppState,
  worktreeId: string
): WorkspaceCheckAutoFixAgentPane[] {
  const panes: WorkspaceCheckAutoFixAgentPane[] = []
  for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
    if (entry.worktreeId === worktreeId) {
      panes.push({ paneKey, state: entry.state, stateStartedAt: entry.stateStartedAt })
    }
  }
  return panes
}

async function handleWorktreeCheckChange(
  worktreeId: string,
  result: WorkspaceCheckState
): Promise<void> {
  const state = useAppStore.getState()
  const worktree = findWorktreeById(state.worktreesByRepo, worktreeId)
  const repoId = worktree?.repoId ?? getRepoIdFromWorktreeId(worktreeId)
  const repo = state.repos.find((candidate) => candidate.id === repoId)
  const progress = getProgress(worktreeId)
  const decision = decideWorkspaceCheckAutoFix({
    result: {
      status: result.status,
      exitCode: result.exitCode,
      error: result.error,
      finishedAt: result.finishedAt
    },
    lastProcessedFinishedAt: progress.lastProcessedFinishedAt,
    repoCheckAutoFix: repo?.checkAutoFix === true,
    attemptCount: progress.attemptCount,
    agentPanes: collectAgentPanes(state, worktreeId)
  })
  if (decision.type === 'ignore') {
    return
  }
  progress.lastProcessedFinishedAt = decision.finishedAt
  if (decision.type === 'reset-attempts') {
    progress.attemptCount = 0
    progress.limitToastShown = false
    return
  }
  if (decision.type === 'limit-reached') {
    if (progress.limitToastShown) {
      return
    }
    progress.limitToastShown = true
    toast.warning(
      translate(
        'auto.components.workspace-check.workspace-check-auto-fix.limitReached',
        'Auto-fix stopped after 3 attempts ({{value0}})',
        { value0: worktree?.displayName ?? worktreeId }
      )
    )
    return
  }
  const parsed = parsePaneKey(decision.paneKey)
  if (!parsed) {
    return
  }
  const prompt = buildWorkspaceCheckAutoFixPrompt({
    command: result.command,
    exitCode: result.exitCode,
    output: `${result.stderr}\n${result.stdout}`.trim()
  })
  progress.attemptCount += 1
  await sendNotesToActiveAgentSession({
    worktreeId,
    prompt,
    noteTarget: { tabId: parsed.tabId, leafId: parsed.leafId }
  })
}

/** Installs the app-level subscriber that resends a failed workspace-check's output to
 *  the finished agent in that worktree when the repo opts in (`Repo.checkAutoFix`), up
 *  to 3 consecutive attempts, resetting once the check passes. Returns the unsubscribe. */
export function installWorkspaceCheckAutoFix(): () => void {
  return useAppStore.subscribe((state, previousState) => {
    const current = state.workspaceCheckStateByWorktreeId
    const previous = previousState.workspaceCheckStateByWorktreeId
    if (current === previous) {
      return
    }
    for (const [worktreeId, result] of Object.entries(current)) {
      if (!result || result === previous[worktreeId]) {
        continue
      }
      void handleWorktreeCheckChange(worktreeId, result)
    }
  })
}

export function useWorkspaceCheckAutoFix(): void {
  useEffect(() => installWorkspaceCheckAutoFix(), [])
}
