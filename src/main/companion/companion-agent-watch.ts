// Watches other agents' hook status (never the companion's own headless brain turns) and
// turns a done/blocked/waiting transition into a short Russian toast in the companion panel —
// backlog #6: "агент закончил / ждёт решения → короткое уведомление, кнопка «обсудить»".
//
// Policy here is presentation only, same spirit as the Agent Status section of AGENTS.md: the
// hook server (`agentHookServer`) is the single source of truth for what happened to an agent;
// this module only decides whether/when to surface that as a notice.

import type { AgentStatusState } from '../../shared/agent-status-types'
import type { CompanionAgentNotice, CompanionNotifySettings } from '../../shared/companion-types'
import type { CompanionConversationState } from './companion-conversation'
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

const COALESCE_WINDOW_MS = 20_000
const WORKSPACE_COOLDOWN_MS = 5 * 60_000
const NOTICE_SUMMARY_MAX_LENGTH = 140

/** States that ever produce a notice. `working` is excluded: it is not an agent asking for
 *  attention, and if included it would also force-seed `previousStateByPaneKey` noisily. */
export type CompanionWatchedAgentState = Exclude<AgentStatusState, 'working'>

function isWatchedAgentState(state: AgentStatusState): state is CompanionWatchedAgentState {
  return state === 'done' || state === 'blocked' || state === 'waiting'
}

const STATE_WORDS_RU: Record<CompanionWatchedAgentState, string> = {
  done: 'готово',
  blocked: 'застрял',
  waiting: 'ждёт решения'
}

/** First line of the agent's last reply, trimmed and capped — the notice's one line of context. */
export function buildAgentNoticeSummary(lastAssistantMessage: string | undefined): string {
  const firstLine = (lastAssistantMessage ?? '').split('\n')[0]?.trim() ?? ''
  if (firstLine.length <= NOTICE_SUMMARY_MAX_LENGTH) {
    return firstLine
  }
  return `${firstLine.slice(0, NOTICE_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`
}

export type CompanionAgentNoticeEntry = {
  workspaceLabel: string
  state: CompanionWatchedAgentState
  summary: string
}

/** Short informal Russian text, e.g. «zveno: готово. Есть вопросы — обсудим?» for one
 *  transition, or a semicolon-joined list when several coalesced within the same window. */
export function buildAgentNoticeText(entries: readonly CompanionAgentNoticeEntry[]): string {
  if (entries.length === 1) {
    const [entry] = entries
    const head = `${entry.workspaceLabel}: ${STATE_WORDS_RU[entry.state]}.`
    return entry.summary === '' ? head : `${head} ${entry.summary}`
  }
  return `${entries.map((entry) => `${entry.workspaceLabel}: ${STATE_WORDS_RU[entry.state]}`).join('; ')}.`
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** Handles the quiet window wrapping past midnight (default 22:00\u201308:00): `from > to` means
 *  "now" is quiet when it is at or after `from`, OR before `to`, instead of only between them. */
export function isWithinQuietHours(time: Date, quietFrom: string, quietTo: string): boolean {
  const from = parseTimeToMinutes(quietFrom)
  const to = parseTimeToMinutes(quietTo)
  if (from === null || to === null || from === to) {
    return false
  }
  const nowMinutes = time.getHours() * 60 + time.getMinutes()
  return from < to ? nowMinutes >= from && nowMinutes < to : nowMinutes >= from || nowMinutes < to
}

/** The minimal shape `companion-agent-watch` reads off an enriched hook status event \u2014 a
 *  structural subset of `EnrichedAgentHookEventPayload`, kept narrow so tests don't need to
 *  construct a full hook payload. */
export type CompanionWatchedStatusEvent = {
  paneKey: string
  worktreeId?: string
  providerSession?: { id: string }
  payload: {
    state: AgentStatusState
    sessionBoundary?: boolean
    lastAssistantMessage?: string
  }
}

export type CompanionAgentWatchDeps = {
  /** `agentHookServer.subscribeEnrichedStatus` in production \u2014 no replay, every hook event. */
  subscribeEnrichedStatus: (listener: (event: CompanionWatchedStatusEvent) => void) => () => void
  getNotifySettings: () => CompanionNotifySettings
  getConversationState: () => CompanionConversationState
  onConversationStateChange: (listener: (state: CompanionConversationState) => void) => () => void
  /** Resolves a hook event's `worktreeId` (or, absent one, its `paneKey`) to display text. */
  resolveWorkspaceLabel: (workspaceId: string) => string
  /** The companion brain's own live Claude session id, so its headless turns are never
   *  mistaken for another agent finishing. Null when no turn is in flight. */
  getCompanionProviderSessionId: () => string | null
  deliverNotice: (notice: CompanionAgentNotice) => void
  now?: () => number
}

type PendingTransition = {
  workspaceId: string
  entry: CompanionAgentNoticeEntry
}

/** One live watcher instance. Main wires one singleton (`initCompanionAgentWatch`); tests
 *  construct their own with fake deps to drive the policy directly. */
export class CompanionAgentWatch {
  private readonly deps: CompanionAgentWatchDeps
  private readonly now: () => number
  private readonly previousStateByPaneKey = new Map<string, AgentStatusState>()
  private readonly lastNotifiedAtByWorkspace = new Map<string, number>()
  private coalesceBuffer: PendingTransition[] = []
  private coalesceTimer: ReturnType<typeof setTimeout> | undefined = undefined
  private pendingNotices: CompanionAgentNotice[] = []
  private noticeSeq = 0
  private readonly unsubscribeStatus: () => void
  private readonly unsubscribeConversation: () => void

  constructor(deps: CompanionAgentWatchDeps) {
    this.deps = deps
    this.now = deps.now ?? (() => Date.now())
    this.unsubscribeStatus = deps.subscribeEnrichedStatus((event) => this.handleStatus(event))
    this.unsubscribeConversation = deps.onConversationStateChange((state) => {
      if (state === 'idle') {
        this.flushPending()
      }
    })
  }

  dispose(): void {
    this.unsubscribeStatus()
    this.unsubscribeConversation()
    if (this.coalesceTimer) {
      clearTimeout(this.coalesceTimer)
      this.coalesceTimer = undefined
    }
  }

  /** Re-attempts delivery of quiet-hours-held notices; cheap to call on a periodic timer so a
   *  notice held at 23:50 is offered once 08:00 passes, without the companion ever reconnecting. */
  checkPendingDeliveries(): void {
    this.flushPending()
  }

  getPendingNoticeCount(): number {
    return this.pendingNotices.length
  }

  private handleStatus(event: CompanionWatchedStatusEvent): void {
    if (!this.deps.getNotifySettings().enabled) {
      return
    }
    const ownSessionId = this.deps.getCompanionProviderSessionId()
    if (ownSessionId !== null && event.providerSession?.id === ownSessionId) {
      return
    }
    const state = event.payload.state
    const previousState = this.previousStateByPaneKey.get(event.paneKey)
    this.previousStateByPaneKey.set(event.paneKey, state)
    if (previousState === state || !isWatchedAgentState(state)) {
      return
    }
    // Same convention every hook provider already uses (STA-3386): a `done` session boundary
    // (SessionStart/PostCompact landing idle) is not a completed turn, just the session settling.
    if (state === 'done' && event.payload.sessionBoundary === true) {
      return
    }
    const workspaceId = event.worktreeId ?? event.paneKey
    this.enqueueTransition({
      workspaceId,
      entry: {
        workspaceLabel: this.deps.resolveWorkspaceLabel(workspaceId),
        state,
        summary: buildAgentNoticeSummary(event.payload.lastAssistantMessage)
      }
    })
  }

  private enqueueTransition(transition: PendingTransition): void {
    this.coalesceBuffer.push(transition)
    if (this.coalesceTimer) {
      return
    }
    this.coalesceTimer = setTimeout(() => {
      this.coalesceTimer = undefined
      this.flushCoalesceBuffer()
    }, COALESCE_WINDOW_MS)
  }

  private flushCoalesceBuffer(): void {
    const transitions = this.coalesceBuffer
    this.coalesceBuffer = []
    const now = this.now()
    const admitted = transitions.filter((transition) => {
      const lastNotifiedAt = this.lastNotifiedAtByWorkspace.get(transition.workspaceId)
      return lastNotifiedAt === undefined || now - lastNotifiedAt >= WORKSPACE_COOLDOWN_MS
    })
    if (admitted.length === 0) {
      return
    }
    for (const transition of admitted) {
      this.lastNotifiedAtByWorkspace.set(transition.workspaceId, now)
    }
    this.noticeSeq += 1
    this.admitNotice({
      id: `companion-notice-${this.noticeSeq}`,
      text: buildAgentNoticeText(admitted.map((transition) => transition.entry)),
      createdAt: now
    })
  }

  private admitNotice(notice: CompanionAgentNotice): void {
    if (this.shouldHoldNotice()) {
      this.pendingNotices.push(notice)
      return
    }
    this.deps.deliverNotice(notice)
  }

  private shouldHoldNotice(): boolean {
    if (this.deps.getConversationState() !== 'idle') {
      return true
    }
    const settings = this.deps.getNotifySettings()
    return isWithinQuietHours(new Date(this.now()), settings.quietFrom, settings.quietTo)
  }

  private flushPending(): void {
    if (this.pendingNotices.length === 0 || this.shouldHoldNotice()) {
      return
    }
    const toDeliver = this.pendingNotices
    this.pendingNotices = []
    for (const notice of toDeliver) {
      this.deps.deliverNotice(notice)
    }
  }
}

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
  if (action === 'discuss' && notice && companionConversation.getState() === 'idle') {
    setPendingDiscussionContext({ notice })
    companionConversation.start()
    showCompanionPanelForNotice()
    sendToCompanionWindow('companion:conversationOpened')
  } else if (companionConversation.getState() === 'idle') {
    hideCompanionPanel()
  }
}

let watchInstance: CompanionAgentWatch | null = null
let pendingDeliveryCheckTimer: ReturnType<typeof setInterval> | undefined = undefined

/** Wires the one companion-agent-watch singleton to the live hook server and conversation
 *  state, and starts a periodic check so a quiet-hours-held notice still surfaces once the
 *  window passes, even with no new agent activity to trigger it. Mirrors `initCompanionHotkey`. */
export function initCompanionAgentWatch(store: CompanionAgentWatchStore): () => void {
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
    deliverNotice: deliverCompanionNoticeToPanel
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
