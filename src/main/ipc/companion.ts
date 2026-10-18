import { ipcMain } from 'electron'
import { normalizeCompanionSettings } from '../persistence/applying-settings/companion-settings-normalization'
import {
  companionConversation,
  type CompanionConversationState
} from '../companion/companion-conversation'
import {
  getCompanionHotkeyStatus,
  toggleCompanionConversation,
  type CompanionHotkeySettingsStore
} from '../companion/companion-shortcut'
import { companionDialogueHandle } from '../companion/companion-dialogue'
import { hideCompanionPanel, sendToCompanionWindow } from '../window/companion-window'
import { reportAudioState, type CompanionAudioState } from '../companion/companion-audio-output'
import { parseCompanionVoiceActivityFrame } from '../companion/companion-voice-barge-in'
import { handleCompanionNoticeAction } from '../companion/companion-agent-watch'
import {
  getCompanionListeningStatus,
  reportCompanionListeningHealth
} from '../companion/companion-listening-health'
import {
  dismissCompanionAddress,
  isCompanionWakeListeningEnabled,
  routeCompanionUtterance,
  type CompanionUtteranceResult
} from '../companion/companion-wake-listening'

function parseUtteranceLevel(meta: unknown): number | undefined {
  const level =
    typeof meta === 'object' && meta !== null && 'level' in meta ? meta.level : undefined
  return typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1
    ? level
    : undefined
}

export function registerCompanionHandlers(store: CompanionHotkeySettingsStore): void {
  ipcMain.removeHandler('companion:getSettings')
  ipcMain.removeHandler('companion:getHotkeyStatus')
  ipcMain.removeHandler('companion:getConversationState')
  ipcMain.removeHandler('companion:toggle')
  ipcMain.removeHandler('companion:reportUtterance')
  ipcMain.removeHandler('companion:hide')
  ipcMain.removeHandler('companion:audio-state')
  ipcMain.removeHandler('companion:voiceActivity')
  ipcMain.removeHandler('companion:resetConversation')
  ipcMain.removeHandler('companion:noticeAction')
  ipcMain.removeHandler('companion:getListeningStatus')
  ipcMain.removeHandler('companion:reportListeningHealth')

  ipcMain.handle('companion:getSettings', () =>
    normalizeCompanionSettings(store.getSettings().companion)
  )

  ipcMain.handle('companion:getHotkeyStatus', () => getCompanionHotkeyStatus())

  ipcMain.handle('companion:getListeningStatus', () => getCompanionListeningStatus())

  // Why: wake mode's background listening never shows the panel, so a failed dictation
  // start there has nowhere else to surface — this is how it reaches the Settings pane.
  ipcMain.handle('companion:reportListeningHealth', (_event, payload: unknown) => {
    const ok =
      typeof payload === 'object' && payload !== null && 'ok' in payload && payload.ok === true
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload ? payload.error : null
    reportCompanionListeningHealth(ok, typeof error === 'string' ? error : null)
  })

  ipcMain.handle('companion:getConversationState', (): CompanionConversationState =>
    companionConversation.getState()
  )

  // Why: the only trigger the panel needs besides the global hotkey — also
  // doubles as the background-launch test entry point (no window show/focus).
  ipcMain.handle('companion:toggle', () => {
    toggleCompanionConversation()
  })

  ipcMain.handle(
    'companion:reportUtterance',
    (_event, text: unknown, meta: unknown): CompanionUtteranceResult => {
      if (typeof text !== 'string' || text.trim() === '') {
        return { stopped: false }
      }
      return routeCompanionUtterance(text, parseUtteranceLevel(meta), {
        bargeIn: () => companionDialogueHandle.current?.bargeIn()
      })
    }
  )

  // Why `keepListening`: in wake mode hiding the panel only ends the addressed exchange;
  // the mic keeps listening for the wake phrase.
  ipcMain.handle('companion:hide', (): { keepListening: boolean } => {
    hideCompanionPanel()
    if (isCompanionWakeListeningEnabled()) {
      dismissCompanionAddress()
      return { keepListening: true }
    }
    companionConversation.stop()
    return { keepListening: false }
  })

  // Why: playback progress is reported, not requested — the panel owns WebAudio
  // scheduling; main only needs state to drive the STT pause/resume around TTS.
  ipcMain.handle('companion:audio-state', (_event, state: CompanionAudioState) => {
    reportAudioState(state)
  })

  // Why a reply value: the panel hands its pre-roll mic audio to STT only when its own
  // frame was the one that barged in, so the start of the user's phrase is not lost.
  ipcMain.handle('companion:voiceActivity', (_event, frame: unknown): { bargedIn: boolean } => {
    const parsed = parseCompanionVoiceActivityFrame(frame)
    if (!parsed) {
      return { bargedIn: false }
    }
    return { bargedIn: companionDialogueHandle.current?.reportVoiceActivity(parsed) ?? false }
  })

  // Why: closing the panel keeps the brain session for continuity; this is the explicit
  // "Новый разговор" action (panel menu / settings) that drops it.
  ipcMain.handle('companion:resetConversation', () => {
    companionDialogueHandle.current?.resetConversation()
    sendToCompanionWindow('companion:conversationReset')
  })

  ipcMain.handle('companion:noticeAction', (_event, payload: unknown) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('id' in payload) ||
      !('action' in payload)
    ) {
      return
    }
    const { id, action } = payload
    if (typeof id !== 'string' || (action !== 'discuss' && action !== 'later')) {
      return
    }
    handleCompanionNoticeAction(action, id)
  })
}
