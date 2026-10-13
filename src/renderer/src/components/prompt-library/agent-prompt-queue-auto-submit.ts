import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { sendNotesToActiveAgentSession } from '@/lib/active-agent-note-send'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { translate } from '@/i18n/i18n'
import {
  clearAgentPromptQueue,
  dequeueAgentPromptHead,
  listQueuedPaneKeys,
  peekAgentPromptQueueHead
} from './agent-prompt-queue'

async function submitQueuedHead(paneKey: string): Promise<void> {
  const head = peekAgentPromptQueueHead(paneKey)
  if (!head) {
    return
  }
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return
  }
  const result = await sendNotesToActiveAgentSession({
    worktreeId: head.worktreeId,
    prompt: head.item.text,
    noteTarget: { tabId: parsed.tabId, leafId: parsed.leafId }
  })
  if (result.status === 'sent' || result.status === 'unconfirmed') {
    dequeueAgentPromptHead(paneKey)
    return
  }
  // Why: leave the item at the head so the next time this pane's agent finishes
  // a turn, the same follow-up is retried instead of silently dropped.
  toast.error(
    translate(
      'auto.components.prompt-library.agent-prompt-queue-auto-submit.sendFailed',
      'Could not send the queued follow-up prompt.'
    )
  )
}

/** Installs the app-level subscriber that pops and sends each pane's next queued
 *  follow-up prompt once that pane's agent leaves `working` for a non-interrupted
 *  `done`, and drops a pane's queue once its agent status entry disappears
 *  (pane/tab closed). Returns the unsubscribe. */
export function installAgentPromptQueueAutoSubmit(): () => void {
  return useAppStore.subscribe((state, previousState) => {
    const current = state.agentStatusByPaneKey
    const previous = previousState.agentStatusByPaneKey
    if (current === previous) {
      return
    }
    for (const paneKey of listQueuedPaneKeys()) {
      if (!(paneKey in current)) {
        clearAgentPromptQueue(paneKey)
      }
    }
    for (const paneKey of listQueuedPaneKeys()) {
      const entry = current[paneKey]
      const previousEntry = previous[paneKey]
      if (!entry || !previousEntry) {
        continue
      }
      if (previousEntry.state === 'working' && entry.state === 'done' && entry.interrupted !== true) {
        void submitQueuedHead(paneKey)
      }
    }
  })
}

export function useAgentPromptQueueAutoSubmit(): void {
  useEffect(() => installAgentPromptQueueAutoSubmit(), [])
}
