import type {
  CompanionAgentNotice,
  CompanionAudioChunk,
  CompanionAudioState,
  CompanionConversationState,
  CompanionHotkeyStatus,
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionVoiceActivityFrame
} from '../../shared/companion-types'

export type CompanionApi = {
  getSettings: () => Promise<CompanionSettings>
  getHotkeyStatus: () => Promise<CompanionHotkeyStatus>
  getConversationState: () => Promise<CompanionConversationState>
  /** Also the background-launch test entry point — no window show/focus. */
  toggle: () => Promise<void>
  /** `level`: peak mic meter level over the utterance, used by wake mode's follow-up filter.
   *  `ignored`: wake mode decided it was not meant for Jarvis. */
  reportUtterance: (
    text: string,
    meta?: { level?: number }
  ) => Promise<{ stopped: boolean; ignored?: boolean }>
  /** `keepListening`: wake mode keeps the mic on after the panel hides. */
  hide: () => Promise<{ keepListening: boolean }>
  /** Drops the brain session + any in-flight audio; keeps the conversation open if it is. */
  resetConversation: () => Promise<void>
  reportAudioState: (state: CompanionAudioState) => Promise<void>
  /** One mic frame while a reply plays; `bargedIn` when it was the frame that interrupted. */
  reportVoiceActivity: (frame: CompanionVoiceActivityFrame) => Promise<{ bargedIn: boolean }>
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
