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
import { handleCompanionNoticeAction } from '../companion/companion-agent-watch'

export function registerCompanionHandlers(store: CompanionHotkeySettingsStore): void {
  ipcMain.removeHandler('companion:getSettings')
  ipcMain.removeHandler('companion:getHotkeyStatus')
  ipcMain.removeHandler('companion:getConversationState')
  ipcMain.removeHandler('companion:toggle')
  ipcMain.removeHandler('companion:reportUtterance')
  ipcMain.removeHandler('companion:hide')
  ipcMain.removeHandler('companion:audio-state')
  ipcMain.removeHandler('companion:resetConversation')
  ipcMain.removeHandler('companion:noticeAction')

  ipcMain.handle('companion:getSettings', () =>
    normalizeCompanionSettings(store.getSettings().companion)
  )

  ipcMain.handle('companion:getHotkeyStatus', () => getCompanionHotkeyStatus())

  ipcMain.handle('companion:getConversationState', (): CompanionConversationState =>
    companionConversation.getState()
  )

  // Why: the only trigger the panel needs besides the global hotkey — also
  // doubles as the background-launch test entry point (no window show/focus).
  ipcMain.handle('companion:toggle', () => {
    toggleCompanionConversation()
  })

  ipcMain.handle('companion:reportUtterance', (_event, text: unknown): { stopped: boolean } => {
    if (typeof text !== 'string' || text.trim() === '') {
      return { stopped: false }
    }
    const result = companionConversation.reportUtterance(text)
    if (result.stopped) {
      hideCompanionPanel()
    }
    return result
  })

  ipcMain.handle('companion:hide', () => {
    companionConversation.stop()
    hideCompanionPanel()
  })

  // Why: playback progress is reported, not requested — the panel owns WebAudio
  // scheduling; main only needs state to drive the STT pause/resume around TTS.
  ipcMain.handle('companion:audio-state', (_event, state: CompanionAudioState) => {
    reportAudioState(state)
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
