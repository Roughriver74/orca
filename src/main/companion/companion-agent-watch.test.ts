// companion-agent-watch.ts's production wiring (not exercised by these behavior tests) imports
// companion-window.ts, which imports 'electron' — unavailable outside a packaged app.
vi.mock('electron', () => ({}))
vi.mock('../window/companion-window', () => ({
  showCompanionPanelForNotice: vi.fn(),
  hideCompanionPanel: vi.fn(),
  sendToCompanionWindow: vi.fn()
}))

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionAgentNotice, CompanionNotifySettings } from '../../shared/companion-types'
import type { CompanionConversationState } from './companion-conversation'
import {
  CompanionAgentWatch,
  isWithinQuietHours,
  type CompanionAgentWatchDeps,
  type CompanionWatchedStatusEvent
} from './companion-agent-watch-policy'
import {
  resetCompanionAgentWatchDiscussionContextForTests,
  setPendingDiscussionContext,
  takePendingDiscussionContext
} from './companion-agent-watch'

const DEFAULT_NOTIFY_SETTINGS: CompanionNotifySettings = {
  enabled: true,
  quietFrom: '22:00',
  quietTo: '08:00',
  speakAloud: true
}

function doneEvent(
  overrides: Partial<CompanionWatchedStatusEvent> = {}
): CompanionWatchedStatusEvent {
  return {
    paneKey: 'tab-1:leaf-1',
    worktreeId: 'repo-1::/repo/zveno',
    payload: { state: 'done', lastAssistantMessage: 'Есть вопросы — обсудим?' },
    ...overrides
  }
}

type Harness = {
  watch: CompanionAgentWatch
  statusListener: (event: CompanionWatchedStatusEvent) => void
  conversationListener: (state: CompanionConversationState) => void
  delivered: CompanionAgentNotice[]
  spoken: string[]
  setNotifySettings: (settings: Partial<CompanionNotifySettings>) => void
  setConversationState: (state: CompanionConversationState) => void
  setNow: (time: number) => void
  setOwnProviderSessionId: (id: string | null) => void
  resolveWorkspaceLabel: (workspaceId: string) => string
}

function createHarness(overrides: Partial<CompanionAgentWatchDeps> = {}): Harness {
  let notifySettings = { ...DEFAULT_NOTIFY_SETTINGS }
  let conversationState: CompanionConversationState = 'idle'
  let now = Date.parse('2026-10-18T12:00:00')
  let ownProviderSessionId: string | null = null
  const delivered: CompanionAgentNotice[] = []
  const spoken: string[] = []
  let statusListener: (event: CompanionWatchedStatusEvent) => void = () => undefined
  let conversationListener: (state: CompanionConversationState) => void = () => undefined
  const resolveWorkspaceLabel = vi.fn((workspaceId: string) =>
    workspaceId.includes('zveno') ? 'zveno' : workspaceId.includes('omp') ? 'omp' : workspaceId
  )

  const watch = new CompanionAgentWatch({
    subscribeEnrichedStatus: (listener) => {
      statusListener = listener
      return () => undefined
    },
    getNotifySettings: () => notifySettings,
    getConversationState: () => conversationState,
    onConversationStateChange: (listener) => {
      conversationListener = listener
      return () => undefined
    },
    resolveWorkspaceLabel,
    getCompanionProviderSessionId: () => ownProviderSessionId,
    deliverNotice: (notice) => delivered.push(notice),
    speakNotice: (phrase) => spoken.push(phrase),
    now: () => now,
    ...overrides
  })

  return {
    watch,
    statusListener: (event) => statusListener(event),
    conversationListener: (state) => conversationListener(state),
    delivered,
    spoken,
    setNotifySettings: (updates) => {
      notifySettings = { ...notifySettings, ...updates }
    },
    setConversationState: (state) => {
      conversationState = state
    },
    setNow: (time) => {
      now = time
    },
    setOwnProviderSessionId: (id) => {
      ownProviderSessionId = id
    },
    resolveWorkspaceLabel
  }
}

describe('isWithinQuietHours', () => {
  it('treats a same-day window as a simple range', () => {
    expect(isWithinQuietHours(new Date(2026, 0, 1, 13, 0), '12:00', '14:00')).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 15, 0), '12:00', '14:00')).toBe(false)
  })

  it('wraps a midnight-crossing window (default 22:00\u201308:00)', () => {
    expect(isWithinQuietHours(new Date(2026, 0, 1, 23, 30), '22:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 3, 0), '22:00', '08:00')).toBe(true)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 8, 0), '22:00', '08:00')).toBe(false)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 21, 59), '22:00', '08:00')).toBe(false)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), '22:00', '08:00')).toBe(false)
  })

  it('is never quiet for an equal or malformed boundary', () => {
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), '09:00', '09:00')).toBe(false)
    expect(isWithinQuietHours(new Date(2026, 0, 1, 12, 0), 'nope', '08:00')).toBe(false)
  })
})

describe('CompanionAgentWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('delivers a notice for a genuine done transition, once the coalescing window elapses', () => {
    const h = createHarness()
    h.statusListener({ ...doneEvent(), payload: { state: 'working' } })
    h.statusListener(doneEvent())
    expect(h.delivered).toHaveLength(0)
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0].text).toBe('zveno: готово. Есть вопросы — обсудим?')
  })

  it('does not fire on a same-state repeat (no transition) or on working', () => {
    const h = createHarness()
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
  })

  it('ignores a done session-boundary row (SessionStart/PostCompact landing idle)', () => {
    const h = createHarness()
    h.statusListener({ ...doneEvent(), payload: { state: 'working' } })
    h.statusListener({
      ...doneEvent(),
      payload: { state: 'done', sessionBoundary: true, lastAssistantMessage: 'noise' }
    })
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(0)
  })

  it('excludes the companion brain\u2019s own provider session', () => {
    const h = createHarness()
    h.setOwnProviderSessionId('companion-session-1')
    h.statusListener({ ...doneEvent(), providerSession: { id: 'companion-session-1' } })
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(0)
  })

  it('drops entirely when notifications are disabled', () => {
    const h = createHarness()
    h.setNotifySettings({ enabled: false })
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(0)
  })

  it('coalesces transitions from several agents within the 20s window into one notice', () => {
    const h = createHarness()
    h.statusListener(doneEvent({ paneKey: 'tab-1:leaf-1', worktreeId: 'repo-1::/repo/zveno' }))
    vi.advanceTimersByTime(5_000)
    h.statusListener(
      doneEvent({
        paneKey: 'tab-2:leaf-1',
        worktreeId: 'repo-2::/repo/omp',
        payload: { state: 'blocked' }
      })
    )
    vi.advanceTimersByTime(15_000)
    expect(h.delivered).toHaveLength(1)
    expect(h.delivered[0].text).toBe('zveno: готово; omp: застрял.')
  })

  it('applies a 5-minute per-workspace cooldown after a delivered notice', () => {
    const h = createHarness()
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
    h.statusListener({ ...doneEvent(), payload: { state: 'working' } })
    h.statusListener({ ...doneEvent(), payload: { state: 'waiting' } })
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
    h.setNow(Date.parse('2026-10-18T12:00:00') + 5 * 60_000 + 1)
    h.statusListener({ ...doneEvent(), payload: { state: 'working' } })
    h.statusListener({ ...doneEvent(), payload: { state: 'blocked' } })
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(2)
  })

  it('suppresses delivery during quiet hours but keeps the notice pending, delivering on the next check', () => {
    const h = createHarness()
    h.setNow(Date.parse('2026-10-18T23:30:00'))
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(0)
    expect(h.watch.getPendingNoticeCount()).toBe(1)
    h.watch.checkPendingDeliveries()
    expect(h.delivered).toHaveLength(0)
    h.setNow(Date.parse('2026-10-19T08:30:00'))
    h.watch.checkPendingDeliveries()
    expect(h.delivered).toHaveLength(1)
    expect(h.watch.getPendingNoticeCount()).toBe(0)
  })

  it('never notifies mid-conversation, and flushes the pending notice once it ends', () => {
    const h = createHarness()
    h.setConversationState('listening')
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(0)
    expect(h.watch.getPendingNoticeCount()).toBe(1)
    h.conversationListener('thinking')
    expect(h.delivered).toHaveLength(0)
    h.setConversationState('idle')
    h.conversationListener('idle')
    expect(h.delivered).toHaveLength(1)
  })
})

describe('CompanionAgentWatch speaking aloud', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says one line for a coalesced group, shortly after the toast', () => {
    const h = createHarness()
    h.statusListener(doneEvent({ paneKey: 'tab-1:leaf-1', worktreeId: 'repo-1::/repo/zveno' }))
    h.statusListener(doneEvent({ paneKey: 'tab-2:leaf-1', worktreeId: 'repo-2::/repo/omp' }))
    vi.advanceTimersByTime(20_000)
    expect(h.delivered).toHaveLength(1)
    expect(h.spoken).toEqual([])
    vi.advanceTimersByTime(1_500)
    expect(h.spoken).toEqual(['В проектах zveno и omp агенты закончили, ждут тебя.'])
  })

  it('stays silent within the per-project pause, like the toast', () => {
    const h = createHarness()
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(21_500)
    h.statusListener({ ...doneEvent(), payload: { state: 'working' } })
    h.statusListener({ ...doneEvent(), payload: { state: 'waiting' } })
    vi.advanceTimersByTime(21_500)
    expect(h.spoken).toHaveLength(1)
  })

  it('stays silent in quiet hours and speaks once they pass', () => {
    const h = createHarness()
    h.setNow(Date.parse('2026-10-18T23:30:00'))
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(21_500)
    expect(h.spoken).toEqual([])
    h.setNow(Date.parse('2026-10-19T08:30:00'))
    h.watch.checkPendingDeliveries()
    vi.advanceTimersByTime(1_500)
    expect(h.spoken).toEqual(['В проекте zveno агент закончил, ждёт тебя.'])
  })

  it('never speaks mid-conversation; speaks the held notice once the conversation ends unheard', () => {
    const h = createHarness()
    h.setConversationState('speaking')
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(21_500)
    expect(h.spoken).toEqual([])
    h.setConversationState('idle')
    h.conversationListener('idle')
    vi.advanceTimersByTime(1_500)
    expect(h.spoken).toEqual(['В проекте zveno агент закончил, ждёт тебя.'])
  })

  it('briefs the brain instead, once, and then does not repeat it aloud', () => {
    const h = createHarness()
    h.setConversationState('listening')
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    expect(h.watch.takeBrainBriefing()).toContain('- zveno: готово — "Есть вопросы — обсудим?"')
    expect(h.watch.takeBrainBriefing()).toBeNull()
    h.setConversationState('idle')
    h.conversationListener('idle')
    vi.advanceTimersByTime(1_500)
    expect(h.delivered).toHaveLength(1)
    expect(h.spoken).toEqual([])
  })

  it('drops the line if a conversation opens during the short delay', () => {
    const h = createHarness()
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(20_000)
    h.setConversationState('listening')
    vi.advanceTimersByTime(1_500)
    expect(h.delivered).toHaveLength(1)
    expect(h.spoken).toEqual([])
  })

  it('only shows the toast when speaking aloud is switched off', () => {
    const h = createHarness()
    h.setNotifySettings({ speakAloud: false })
    h.statusListener(doneEvent())
    vi.advanceTimersByTime(21_500)
    expect(h.delivered).toHaveLength(1)
    expect(h.spoken).toEqual([])
  })
})

describe('pending discussion context', () => {
  afterEach(() => {
    resetCompanionAgentWatchDiscussionContextForTests()
  })

  it('is set once and consumed exactly once', () => {
    expect(takePendingDiscussionContext()).toBeNull()
    const notice: CompanionAgentNotice = { id: 'n1', text: 'zveno: готово.', createdAt: 1 }
    setPendingDiscussionContext({ notice })
    expect(takePendingDiscussionContext()).toEqual({ notice })
    expect(takePendingDiscussionContext()).toBeNull()
  })
})
