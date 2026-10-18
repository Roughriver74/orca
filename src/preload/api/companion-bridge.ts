import { ipcRenderer } from 'electron'
import type {
  CompanionAgentNotice,
  CompanionAudioChunk,
  CompanionAudioState,
  CompanionConversationState,
  CompanionHotkeyStatus,
  CompanionListeningStatus,
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionVoiceActivityFrame
} from '../../shared/companion-types'
import type { PreloadApi } from '../api-types'

/** Wire shape for a chunk crossing the IPC boundary: `pcm` travels as bytes, not a Float32Array. */
type WireCompanionAudioChunk = Omit<CompanionAudioChunk, 'pcm'> & { pcm: Uint8Array }

function toFloat32Array(bytes: Uint8Array): Float32Array {
  return new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength / Float32Array.BYTES_PER_ELEMENT
  )
}

export const companionApi = {
  getSettings: (): Promise<CompanionSettings> => ipcRenderer.invoke('companion:getSettings'),
  getHotkeyStatus: (): Promise<CompanionHotkeyStatus> =>
    ipcRenderer.invoke('companion:getHotkeyStatus'),
  getListeningStatus: (): Promise<CompanionListeningStatus> =>
    ipcRenderer.invoke('companion:getListeningStatus'),
  reportListeningHealth: (status: { ok: boolean; error?: string | null }): Promise<void> =>
    ipcRenderer.invoke('companion:reportListeningHealth', status),
  getConversationState: (): Promise<CompanionConversationState> =>
    ipcRenderer.invoke('companion:getConversationState'),
  toggle: (): Promise<void> => ipcRenderer.invoke('companion:toggle'),
  reportUtterance: (
    text: string,
    meta?: { level?: number; embedding?: number[] | null }
  ): Promise<{ stopped: boolean; ignored?: boolean; droppedVoice?: boolean }> =>
    ipcRenderer.invoke('companion:reportUtterance', text, meta),
  hide: (): Promise<{ keepListening: boolean }> => ipcRenderer.invoke('companion:hide'),
  resetConversation: (): Promise<void> => ipcRenderer.invoke('companion:resetConversation'),
  reportAudioState: (state: CompanionAudioState): Promise<void> =>
    ipcRenderer.invoke('companion:audio-state', state),
  reportVoiceActivity: (frame: CompanionVoiceActivityFrame): Promise<{ bargedIn: boolean }> =>
    ipcRenderer.invoke('companion:voiceActivity', frame),
  respondToNotice: (payload: { id: string; action: 'discuss' | 'later' }): Promise<void> =>
    ipcRenderer.invoke('companion:noticeAction', payload),
  reportSpeakingState: (speaking: boolean): Promise<void> =>
    ipcRenderer.invoke('companion:reportSpeakingState', speaking),

  onConversationOpened: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('companion:conversationOpened', listener)
    return () => ipcRenderer.removeListener('companion:conversationOpened', listener)
  },
  onConversationClosed: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('companion:conversationClosed', listener)
    return () => ipcRenderer.removeListener('companion:conversationClosed', listener)
  },
  onConversationReset: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('companion:conversationReset', listener)
    return () => ipcRenderer.removeListener('companion:conversationReset', listener)
  },
  onStateChanged: (callback: (state: CompanionConversationState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: CompanionConversationState): void =>
      callback(state)
    ipcRenderer.on('companion:stateChanged', listener)
    return () => ipcRenderer.removeListener('companion:stateChanged', listener)
  },
  onAssistantDelta: (callback: (text: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on('companion:assistantDelta', listener)
    return () => ipcRenderer.removeListener('companion:assistantDelta', listener)
  },
  onAssistantFinal: (callback: (text: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, text: string): void => callback(text)
    ipcRenderer.on('companion:assistantFinal', listener)
    return () => ipcRenderer.removeListener('companion:assistantFinal', listener)
  },
  onAssistantError: (callback: (message: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string): void => callback(message)
    ipcRenderer.on('companion:assistantError', listener)
    return () => ipcRenderer.removeListener('companion:assistantError', listener)
  },
  onAudioChunk: (callback: (chunk: CompanionAudioChunk) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, chunk: WireCompanionAudioChunk): void =>
      callback({ ...chunk, pcm: toFloat32Array(chunk.pcm) })
    ipcRenderer.on('companion:audio-chunk', listener)
    return () => ipcRenderer.removeListener('companion:audio-chunk', listener)
  },
  onAudioStop: (callback: (payload: { utteranceId?: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { utteranceId?: string }): void =>
      callback(payload)
    ipcRenderer.on('companion:audio-stop', listener)
    return () => ipcRenderer.removeListener('companion:audio-stop', listener)
  },
  onTtsProvisioningStatus: (
    callback: (status: CompanionTtsProvisioningStatus) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: CompanionTtsProvisioningStatus
    ): void => callback(status)
    ipcRenderer.on('companion:ttsProvisioningStatus', listener)
    return () => ipcRenderer.removeListener('companion:ttsProvisioningStatus', listener)
  },
  onListeningStatusChanged: (
    callback: (status: CompanionListeningStatus) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CompanionListeningStatus): void =>
      callback(status)
    ipcRenderer.on('companion:listeningStatusChanged', listener)
    return () => ipcRenderer.removeListener('companion:listeningStatusChanged', listener)
  },
  onNotice: (callback: (notice: CompanionAgentNotice) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, notice: CompanionAgentNotice): void =>
      callback(notice)
    ipcRenderer.on('companion:notice', listener)
    return () => ipcRenderer.removeListener('companion:notice', listener)
  },
  onNoticeDismiss: (callback: (payload: { id: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { id: string }): void =>
      callback(payload)
    ipcRenderer.on('companion:noticeDismiss', listener)
    return () => ipcRenderer.removeListener('companion:noticeDismiss', listener)
  }
} satisfies PreloadApi['companion']
