import { BrowserWindow, ipcMain } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import {
  applyTokenEconomizerEnabled,
  getTokenEconomizerStatus,
  onTokenEconomizerStatusChanged
} from './token-economizer-install'

export const tokenEconomizerIpc = {
  register(): void {
    ipcMain.handle('tokenEconomizer:getStatus', () => getTokenEconomizerStatus())
    onTokenEconomizerStatusChanged((status) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send('tokenEconomizer:changed', status)
        }
      }
    })
  },

  /** Installs or removes TokenEconomizer when the setting flips; not awaited, since the first enable clones the repo. */
  onSettingsChange(
    before: GlobalSettings,
    after: GlobalSettings,
    shouldHydrateShellPath: boolean
  ): void {
    if (before.tokenEconomizerEnabled !== after.tokenEconomizerEnabled) {
      void applyTokenEconomizerEnabled(after.tokenEconomizerEnabled, {
        settings: after,
        shouldHydrateShellPath
      })
    }
  }
}
