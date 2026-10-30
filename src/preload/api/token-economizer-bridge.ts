import { ipcRenderer } from 'electron'
import type { TokenEconomizerStatus } from '../../shared/token-economizer-status'
import type { PreloadApi } from '../api-types'

export const tokenEconomizerApi = {
  getStatus: (): Promise<TokenEconomizerStatus> => ipcRenderer.invoke('tokenEconomizer:getStatus'),
  onChanged: (callback: (status: TokenEconomizerStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: TokenEconomizerStatus): void =>
      callback(status)
    ipcRenderer.on('tokenEconomizer:changed', listener)
    return () => ipcRenderer.removeListener('tokenEconomizer:changed', listener)
  }
} satisfies PreloadApi['tokenEconomizer']
