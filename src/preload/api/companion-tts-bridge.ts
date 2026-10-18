import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const companionTtsApi = {
  getYandexKeyStatus: () => ipcRenderer.invoke('companion:getYandexKeyStatus'),
  saveYandexApiKey: (apiKey: string) => ipcRenderer.invoke('companion:saveYandexApiKey', apiKey),
  clearYandexApiKey: () => ipcRenderer.invoke('companion:clearYandexApiKey'),
  testYandexApiKey: () => ipcRenderer.invoke('companion:testYandexApiKey'),
  getUsage: () => ipcRenderer.invoke('companion:getTtsUsage')
} satisfies PreloadApi['companionTts']
