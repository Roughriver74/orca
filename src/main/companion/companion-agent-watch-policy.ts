// The when/whether policy behind agent notices (backlog #6): coalescing, the per-project pause,
// quiet hours, holding while a conversation is open, and what then gets spoken or briefed.
//
// Policy here is presentation only, same spirit as the Agent Status section of AGENTS.md: the
// hook server (`agentHookServer`) is the single source of truth for what happened to an agent;
// this module only decides whether/when to surface that as a notice.

import type { AgentStatusState } from '../../shared/agent-status-types'
import type { CompanionAgentNotice, CompanionNotifySettings } from '../../shared/companion-types'
import type { CompanionConversationState } from './companion-conversation'
import {
  buildAgentBriefing,
  buildAgentNoticeSpeech,
  buildAgentNoticeSummary,
  buildAgentNoticeText,
  toSpokenWorkspaceLabel,
  type CompanionAgentNoticeEntry,
  type CompanionAgentSpokenItem,
  type CompanionWatchedAgentState
} from './companion-agent-notice-wording'

const COALESCE_WINDOW_MS = 20_000
const WORKSPACE_COOLDOWN_MS = 5 * 60_000
// Why a delay: the toast lands first, and a conversation ending (which stops all TTS on idle)
// has settled before the line starts, whatever order the idle listeners run in.
const NOTICE_SPEECH_DELAY_MS = 1_500

function isWatchedAgentState(state: AgentStatusState): state is CompanionWatchedAgentState {
  return state === 'done' || state === 'blocked' || state === 'waiting'
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
  /** Says one short line aloud; absent where no TTS exists (tests, orcad). Called only while
   *  the conversation is idle, outside quiet hours, with `notify.speakAloud` on. */
  speakNotice?: (phrase: string) => void
  now?: () => number
}

type PendingTransition = {
  workspaceId: string
  entry: CompanionAgentNoticeEntry
  spoken: CompanionAgentSpokenItem
}

type HeldNotice = {
  notice: CompanionAgentNotice
  transitions: PendingTransition[]
  /** Already handed to the brain mid-conversation — still shown as a toast later, never re-spoken. */
  briefedToBrain: boolean
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
  private pendingNotices: HeldNotice[] = []
  private pendingSpeech: CompanionAgentSpokenItem[] = []
  private speechTimer: ReturnType<typeof setTimeout> | undefined = undefined
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
    if (this.speechTimer) {
      clearTimeout(this.speechTimer)
      this.speechTimer = undefined
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

  /** Read-once lines for held notices the brain has not seen yet; the dialogue prepends them to
   *  the user's next utterance. Null when there is nothing new. */
  takeBrainBriefing(): string | null {
    const unbriefed = this.pendingNotices.filter((held) => !held.briefedToBrain)
    if (unbriefed.length === 0) {
      return null
    }
    for (const held of unbriefed) {
      held.briefedToBrain = true
    }
    return buildAgentBriefing(
      unbriefed.flatMap((held) => held.transitions.map((transition) => transition.entry))
    )
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
    const workspaceLabel = this.deps.resolveWorkspaceLabel(workspaceId)
    this.enqueueTransition({
      workspaceId,
      entry: {
        workspaceLabel,
        state,
        summary: buildAgentNoticeSummary(event.payload.lastAssistantMessage)
      },
      spoken: {
        spokenLabel:
          workspaceLabel === workspaceId ? null : toSpokenWorkspaceLabel(workspaceLabel) || null,
        state
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
      notice: {
        id: `companion-notice-${this.noticeSeq}`,
        text: buildAgentNoticeText(admitted.map((transition) => transition.entry)),
        createdAt: now
      },
      transitions: admitted,
      briefedToBrain: false
    })
  }

  private admitNotice(held: HeldNotice): void {
    if (this.shouldHoldNotice()) {
      this.pendingNotices.push(held)
      return
    }
    this.deliver([held])
  }

  private deliver(notices: readonly HeldNotice[]): void {
    for (const held of notices) {
      this.deps.deliverNotice(held.notice)
    }
    this.scheduleSpeech(
      notices
        .filter((held) => !held.briefedToBrain)
        .flatMap((held) => held.transitions.map((transition) => transition.spoken))
    )
  }

  private scheduleSpeech(items: readonly CompanionAgentSpokenItem[]): void {
    if (!this.deps.speakNotice || items.length === 0 || !this.isSpeakAloudEnabled()) {
      return
    }
    this.pendingSpeech.push(...items)
    if (this.speechTimer) {
      return
    }
    this.speechTimer = setTimeout(() => {
      this.speechTimer = undefined
      const toSpeak = this.pendingSpeech
      this.pendingSpeech = []
      // Re-checked: a conversation may have opened (or quiet hours begun) during the delay.
      if (this.shouldHoldNotice() || !this.isSpeakAloudEnabled()) {
        return
      }
      this.deps.speakNotice?.(buildAgentNoticeSpeech(toSpeak))
    }, NOTICE_SPEECH_DELAY_MS)
  }

  private isSpeakAloudEnabled(): boolean {
    const settings = this.deps.getNotifySettings()
    return settings.enabled && settings.speakAloud
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
    this.deliver(toDeliver)
  }
}
