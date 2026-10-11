import { ipcRenderer } from 'electron'
import type { WorkspaceUsageApi } from './agent-usage-api'

export const workspaceUsageApi: WorkspaceUsageApi = {
  getAllToday: () => ipcRenderer.invoke('workspaceUsage:getAllToday')
}
