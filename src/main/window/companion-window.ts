import { BrowserWindow, screen } from 'electron'
import { companionPreloadPath, companionRendererPage } from './companion-window-paths'
import { is } from '@electron-toolkit/utils'
import { isWindowlessLaunch } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { hasSystemMediaAccess, requestSystemMediaAccess } from '../browser/browser-media-access'

const PANEL_WIDTH = 420
const PANEL_HEIGHT = 280
// Why: clear of the macOS menu bar / notch area so the panel never overlaps system chrome.
const TOP_MARGIN = 48
// Why: an own session, so this panel's permission policy can never replace the main window's.
const COMPANION_PANEL_PARTITION = 'companion-panel'

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
    void window.loadFile(companionRendererPage('companion.html'))
  }
}

function createCompanionWindow(): BrowserWindow {
  const bounds = resolvePanelBounds()
  const window = new BrowserWindow({
    ...bounds,
    minWidth: PANEL_WIDTH,
    minHeight: PANEL_HEIGHT,
    // Why: Hyprland floats this panel by its title (`^Джарвис$`) at map time. Without an explicit
    // title the surface maps as "Orca", like the main window, and a resizable panel gets tiled into
    // an empty transparent half of the screen.
    title: 'Джарвис',
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    // Why: on Wayland with fractional output scales Chromium can settle on a device scale
    // other than 1 after the surface is mapped; a non-resizable window keeps its old size
    // while the content re-lays out at the new scale, so the panel is cut off on the
    // right and bottom. A resizable window grows to fit instead.
    resizable: process.platform === 'linux',
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Why: macOS NSPanel (NSWindowStyleMaskNonactivatingPanel) — unlike a
    // normal window, showing/raising a panel never calls
    // activateIgnoringOtherApps, so the hotkey can never pull the user out
    // of a fullscreen Space or steal the OS foreground. No effect on other
    // platforms (an unrecognized `type` is ignored there).
    type: 'panel',
    // Why: voice capture needs no keyboard focus; keeping the panel
    // unfocusable means it can never become the key window either, so
    // BrowserWindow.getFocusedWindow() never changes when it appears.
    focusable: false,
    // Why: with focusable:false the panel can never become key, so without
    // this its buttons (reset conversation, open mic settings) would eat
    // the first click instead of registering it.
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: companionPreloadPath(),
      sandbox: true,
      partition: COMPANION_PANEL_PARTITION,
      webviewTag: false,
      // Why: wake listening runs in this window while it is hidden; Chromium otherwise throttles
      // hidden timers (to ~1/min after 5 min), so the silence timer never finalizes an utterance.
      backgroundThrottling: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)

  window.setAlwaysOnTop(true, 'floating')
  // Why: macOS-only API — the panel must stay reachable from inside Spaces and
  // fullscreen apps, which is the whole point of a global-hotkey companion.
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // The panel only ever needs the microphone; everything else stays denied.
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      if (permission !== 'media') {
        callback(false)
        return
      }
      void requestSystemMediaAccess(details).then(callback, () => callback(false))
    }
  )
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, _origin, details) =>
      permission === 'media' && hasSystemMediaAccess(details?.mediaType)
  )

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

/** Shows (or re-shows at the current cursor display) the panel without ever
 *  activating Orca, raising it to key window, or changing the current
 *  macOS Space — `showInactive()` on a non-activating panel does none of
 *  that, unlike the shared `showWindowWithoutStealingFocus()` (which calls
 *  `window.show()` for ordinary windows in normal interactive runs). */
export function showCompanionPanel(): BrowserWindow {
  const window = ensureCompanionWindowAlive()
  window.setBounds(resolvePanelBounds())
  const reveal = (): void => {
    // Why: automated/background runs must still stay entirely off screen.
    if (!isWindowlessLaunch()) {
      window.showInactive()
    }
  }
  if (window.webContents.isLoading()) {
    window.once('ready-to-show', reveal)
  } else {
    reveal()
  }
  return window
}

/** Shows the panel for a passive agent-watch notice: `showInactive()`
 *  unconditionally, unlike `showCompanionPanel()`'s hotkey open, which still
 *  suppresses reveal entirely under background/E2E-headless launch policy.
 *  Neither path ever activates Orca or changes the key window. */
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
