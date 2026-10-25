// Watches other agents' hook status (never the companion's own headless brain turns) and
// turns a done/blocked/waiting transition into a short Russian toast in the companion panel (plus
// one spoken line, or a brain briefing when a conversation is open) —
// backlog #6: "агент закончил / ждёт решения → короткое уведомление, кнопка «обсудить»".
// The when/whether policy lives in companion-agent-watch-policy.ts; this module wires it to
// the hook server, conversation state, panel and dialogue.

import type { CompanionAgentNotice, CompanionNotifySettings } from '../../shared/companion-types'
import { agentHookServer } from '../agent-hooks/server'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { readStructuredAttentionWorkspaceLabels } from '../runtime/structured-agent-session-mobile-attention'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { companionConversation, onCompanionStateChange } from './companion-conversation'
import { getCompanionBrain } from './companion-brain'
import {
  hideCompanionPanel,
  sendToCompanionWindow,
  showCompanionPanelForNotice
} from '../window/companion-window'
import { normalizeCompanionSettings } from '../persistence/applying-settings/companion-settings-normalization'
import { openCompanionConversationForNotice } from './companion-wake-listening'
import { CompanionAgentWatch } from './companion-agent-watch-policy'

export type CompanionDiscussionContext = { notice: CompanionAgentNotice }

let pendingDiscussionContext: CompanionDiscussionContext | null = null

/** Set when the user taps "Обсудить" on a notice; read once by the brain integration that
 *  opens the conversation turn primed with this context. */
export function setPendingDiscussionContext(context: CompanionDiscussionContext): void {
  pendingDiscussionContext = context
}

export function takePendingDiscussionContext(): CompanionDiscussionContext | null {
  const context = pendingDiscussionContext
  pendingDiscussionContext = null
  return context
}

export function resetCompanionAgentWatchDiscussionContextForTests(): void {
  pendingDiscussionContext = null
}

export type CompanionAgentWatchStore = Pick<
  RuntimeStore,
  'getRepo' | 'getWorktreeMeta' | 'getFolderWorkspaces'
> & {
  getSettings: () => { companion?: { homeDir?: string } }
}

function resolveCompanionWorkspaceLabel(
  store: CompanionAgentWatchStore,
  workspaceId: string
): string {
  const scope = workspaceId.startsWith('folder:')
    ? { workspaceKind: 'folder' as const, workspaceId: workspaceId.slice('folder:'.length) }
    : { workspaceKind: 'git-worktree' as const, workspaceId }
  const labels = readStructuredAttentionWorkspaceLabels(store, {
    executionHostId: LOCAL_EXECUTION_HOST_ID,
    wslDistro: null,
    ...scope
  })
  return labels.worktreeLabel ?? labels.repoLabel ?? workspaceId
}

const NOTICE_AUTO_HIDE_MS = 8_000

let noticeHideTimer: ReturnType<typeof setTimeout> | undefined = undefined
let lastDeliveredNotice: CompanionAgentNotice | null = null

function deliverCompanionNoticeToPanel(notice: CompanionAgentNotice): void {
  lastDeliveredNotice = notice
  showCompanionPanelForNotice()
  sendToCompanionWindow('companion:notice', notice)
  clearTimeout(noticeHideTimer)
  noticeHideTimer = setTimeout(() => {
    noticeHideTimer = undefined
    sendToCompanionWindow('companion:noticeDismiss', { id: notice.id })
    if (companionConversation.getState() === 'idle') {
      hideCompanionPanel()
    }
  }, NOTICE_AUTO_HIDE_MS)
}

/** The toast's "Обсудить"/"Позже" buttons, routed from the `companion:noticeAction` IPC handler. */
export function handleCompanionNoticeAction(action: 'discuss' | 'later', noticeId: string): void {
  if (noticeHideTimer) {
    clearTimeout(noticeHideTimer)
    noticeHideTimer = undefined
  }
  const notice = lastDeliveredNotice?.id === noticeId ? lastDeliveredNotice : null
  sendToCompanionWindow('companion:noticeDismiss', { id: noticeId })
  if (action === 'discuss' && notice && openCompanionConversationForNotice()) {
    setPendingDiscussionContext({ notice })
  } else if (companionConversation.getState() === 'idle') {
    hideCompanionPanel()
  }
}

let watchInstance: CompanionAgentWatch | null = null

/** Read by the dialogue at the start of each user turn; see `CompanionAgentWatch.takeBrainBriefing`. */
export function takeCompanionAgentBriefing(): string | null {
  return watchInstance?.takeBrainBriefing() ?? null
}

let pendingDeliveryCheckTimer: ReturnType<typeof setInterval> | undefined = undefined

/** Wires the one companion-agent-watch singleton to the live hook server and conversation
 *  state, and starts a periodic check so a quiet-hours-held notice still surfaces once the
 *  window passes, even with no new agent activity to trigger it. Mirrors `initCompanionHotkey`. */
export function initCompanionAgentWatch(
  store: CompanionAgentWatchStore,
  options: { speakNotice?: (phrase: string) => void } = {}
): () => void {
  watchInstance?.dispose()
  watchInstance = new CompanionAgentWatch({
    subscribeEnrichedStatus: (listener) =>
      agentHookServer.subscribeEnrichedStatus((event) => listener(event)),
    getNotifySettings: (): CompanionNotifySettings => {
      const companion = normalizeCompanionSettings(store.getSettings().companion)
      return { ...companion.notify, enabled: companion.enabled && companion.notify.enabled }
    },
    getConversationState: () => companionConversation.getState(),
    onConversationStateChange: onCompanionStateChange,
    resolveWorkspaceLabel: (workspaceId) => resolveCompanionWorkspaceLabel(store, workspaceId),
    getCompanionProviderSessionId: () =>
      getCompanionBrain({ getSettings: () => store.getSettings() }).getProviderSessionId(),
    deliverNotice: deliverCompanionNoticeToPanel,
    speakNotice: options.speakNotice
  })
  pendingDeliveryCheckTimer = setInterval(() => watchInstance?.checkPendingDeliveries(), 60_000)
  return () => {
    if (pendingDeliveryCheckTimer) {
      clearInterval(pendingDeliveryCheckTimer)
      pendingDeliveryCheckTimer = undefined
    }
    watchInstance?.dispose()
    watchInstance = null
  }
}
