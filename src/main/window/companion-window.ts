import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { showWindowWithoutStealingFocus } from './foreground-activation-policy'

const PANEL_WIDTH = 420
const PANEL_HEIGHT = 280
// Why: clear of the macOS menu bar / notch area so the panel never overlaps system chrome.
const TOP_MARGIN = 48

// Why: singleton — the hotkey toggles one conversation surface, so a second
// trigger while open focuses/hides the existing window instead of spawning another.
let companionWindow: BrowserWindow | null = null

export function getCompanionWindow(): BrowserWindow | null {
  return companionWindow && !companionWindow.isDestroyed() ? companionWindow : null
}

export function isCompanionPanelOpen(): boolean {
  const window = getCompanionWindow()
  return window !== null && window.isVisible()
}

/** Top-center of the display nearest the cursor, approximating "the active display". */
function resolvePanelBounds(): { x: number; y: number; width: number; height: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x: areaX, y: areaY, width: areaWidth } = display.workArea
  return {
    x: Math.round(areaX + (areaWidth - PANEL_WIDTH) / 2),
    y: areaY + TOP_MARGIN,
    width: PANEL_WIDTH,
    height: PANEL_HEIGHT
  }
}

function loadCompanionPanel(window: BrowserWindow): void {
  // Why: mirror the dashboard pop-out's dev/prod branch — the dev server serves
  // the second HTML entry, prod loads the emitted file.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/companion.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/companion.html'))
  }
}

function createCompanionWindow(): BrowserWindow {
  const bounds = resolvePanelBounds()
  const window = new BrowserWindow({
    ...bounds,
    minWidth: PANEL_WIDTH,
    minHeight: PANEL_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      webviewTag: false
    }
  })

  window.setAlwaysOnTop(true, 'floating')
  // Why: macOS-only API — the panel must stay reachable from inside Spaces and
  // fullscreen apps, which is the whole point of a global-hotkey companion.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)

  window.on('closed', () => {
    if (companionWindow === window) {
      companionWindow = null
    }
  })

  loadCompanionPanel(window)
  companionWindow = window
  return window
}

/** Creates the panel window (hidden) on first use, so it exists whenever
 *  `companion.enabled` — audio playback must work even while the panel is
 *  hidden, not only during an open conversation. */
export function ensureCompanionWindowAlive(): BrowserWindow {
  return getCompanionWindow() ?? createCompanionWindow()
}

/** Shows (or re-shows at the current cursor display) the panel without stealing OS focus. */
export function showCompanionPanel(): BrowserWindow {
  const window = ensureCompanionWindowAlive()
  window.setBounds(resolvePanelBounds())
  if (window.webContents.isLoading()) {
    window.once('ready-to-show', () => showWindowWithoutStealingFocus(window))
  } else {
    showWindowWithoutStealingFocus(window)
  }
  return window
}

/** Shows the panel for a passive agent-watch notice: always `showInactive()`, unlike
 *  `showCompanionPanel()`'s user-initiated hotkey open, which may take the OS foreground
 *  under the normal (non-background) launch policy. A notice must never steal focus. */
export function showCompanionPanelForNotice(): BrowserWindow {
  const window = ensureCompanionWindowAlive()
  window.setBounds(resolvePanelBounds())
  if (window.webContents.isLoading()) {
    window.once('ready-to-show', () => window.showInactive())
  } else {
    window.showInactive()
  }
  return window
}

export function hideCompanionPanel(): void {
  const window = getCompanionWindow()
  if (window && window.isVisible()) {
    window.hide()
  }
}

export function destroyCompanionWindow(): void {
  const window = getCompanionWindow()
  if (window) {
    window.destroy()
  }
  companionWindow = null
}

/** Sends a lifecycle/data event to the companion panel, if it exists. */
export function sendToCompanionWindow(channel: string, ...args: unknown[]): void {
  const window = getCompanionWindow()
  if (window && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
}
