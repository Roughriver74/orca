import type {
  CompanionAgentNotice,
  CompanionAudioChunk,
  CompanionAudioState,
  CompanionConversationState,
  CompanionHotkeyStatus,
  CompanionListeningStatus,
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionVoiceActivityFrame,
  CompanionVoiceActivityResult
} from '../../shared/companion-types'

export type CompanionApi = {
  getSettings: () => Promise<CompanionSettings>
  getHotkeyStatus: () => Promise<CompanionHotkeyStatus>
  getListeningStatus: () => Promise<CompanionListeningStatus>
  /** Reported by the panel after each `speech:startDictation` attempt — wake mode's
   *  background listening never shows the panel, so this is the only way a failed mic
   *  start there (permission, model load) reaches the Settings pane. */
  reportListeningHealth: (status: { ok: boolean; error?: string | null }) => Promise<void>
  getConversationState: () => Promise<CompanionConversationState>
  /** Also the background-launch test entry point — no window show/focus. */
  toggle: () => Promise<void>
  /** `level`: peak mic meter level over the utterance, used by wake mode's follow-up filter.
   *  `embedding`: the finalized VAD segment's speaker embedding (voice focus), when VAD
   *  segmentation was active for this utterance — null/omitted otherwise.
   *  `ignored`: wake mode or voice focus decided it was not meant for Jarvis;
   *  `droppedVoice` distinguishes a voice-focus drop from a wake-gate one. */
  reportUtterance: (
    text: string,
    meta?: { level?: number; embedding?: number[] | null }
  ) => Promise<{ stopped: boolean; ignored?: boolean; droppedVoice?: boolean }>
  /** `keepListening`: wake mode keeps the mic on after the panel hides. */
  hide: () => Promise<{ keepListening: boolean }>
  /** Drops the brain session + any in-flight audio; keeps the conversation open if it is. */
  resetConversation: () => Promise<void>
  reportAudioState: (state: CompanionAudioState) => Promise<void>
  /** One mic frame while a reply plays; `bargedIn` when it was the frame that interrupted,
   *  `ducked` while a possible barge-in awaits VAD confirmation. */
  reportVoiceActivity: (frame: CompanionVoiceActivityFrame) => Promise<CompanionVoiceActivityResult>
  respondToNotice: (payload: { id: string; action: 'discuss' | 'later' }) => Promise<void>
  /** Mic-meter isSpeaking transitions, so the main-process hotkey handler can tell
   *  "press while mid-utterance" (finalize now) from "press while idle" (toggle). */
  reportSpeakingState: (speaking: boolean) => Promise<void>
  /** Hover over the pill's visible shape, reported by the indicator renderer — toggles
   *  `BrowserWindow.setIgnoreMouseEvents` so the otherwise click-through pill still
   *  receives the click that toggles the conversation. */
  reportIndicatorHover: (hovering: boolean) => Promise<void>
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
  onListeningStatusChanged: (callback: (status: CompanionListeningStatus) => void) => () => void
  onNotice: (callback: (notice: CompanionAgentNotice) => void) => () => void
  onNoticeDismiss: (callback: (payload: { id: string }) => void) => () => void
}
