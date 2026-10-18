import type {
  CompanionAgentNotice,
  CompanionAudioChunk,
  CompanionAudioState,
  CompanionConversationState,
  CompanionHotkeyStatus,
  CompanionSettings,
  CompanionTtsProvisioningStatus
} from '../../shared/companion-types'

export type CompanionApi = {
  getSettings: () => Promise<CompanionSettings>
  getHotkeyStatus: () => Promise<CompanionHotkeyStatus>
  getConversationState: () => Promise<CompanionConversationState>
  /** Also the background-launch test entry point — no window show/focus. */
  toggle: () => Promise<void>
  reportUtterance: (text: string) => Promise<{ stopped: boolean }>
  hide: () => Promise<void>
  /** Drops the brain session + any in-flight audio; keeps the conversation open if it is. */
  resetConversation: () => Promise<void>
  reportAudioState: (state: CompanionAudioState) => Promise<void>
  respondToNotice: (payload: { id: string; action: 'discuss' | 'later' }) => Promise<void>
  onConversationOpened: (callback: () => void) => () => void
  onConversationClosed: (callback: () => void) => () => void
  /** Pushed after `resetConversation`: the panel clears its turn history. */
  onConversationReset: (callback: () => void) => () => void
  onStateChanged: (callback: (state: CompanionConversationState) => void) => () => void
  onAssistantDelta: (callback: (text: string) => void) => () => void
  onAssistantFinal: (callback: (text: string) => void) => () => void
  onAssistantError: (callback: (message: string) => void) => () => void
  onAudioChunk: (callback: (chunk: CompanionAudioChunk) => void) => () => void
  onAudioStop: (callback: (payload: { utteranceId?: string }) => void) => () => void
  onTtsProvisioningStatus: (
    callback: (status: CompanionTtsProvisioningStatus) => void
  ) => () => void
  onNotice: (callback: (notice: CompanionAgentNotice) => void) => () => void
  onNoticeDismiss: (callback: (payload: { id: string }) => void) => () => void
}
