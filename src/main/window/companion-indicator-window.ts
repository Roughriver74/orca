import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { isWindowlessLaunch } from './foreground-activation-policy'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'

// Backlog #28: a tiny always-on-top pill that shows Jarvis's state (listening/thinking/
// speaking) without ever covering the user's windows — the big companion-window.ts panel is
// now reserved for explicit requests. Only shown when Riverline's own menu-bar notch isn't
// already doing this job (companion-riverline-detection.ts decides that; this module just
// shows/hides on command).
const INDICATOR_WIDTH = 120
const INDICATOR_HEIGHT = 28
// Why smaller than companion-window.ts's TOP_MARGIN (48): the pill is thin enough to sit
// right under the menu bar/notch without touching it, unlike the panel which needs room to
// clear the camera/notch cutout area on its wider body.
const TOP_MARGIN = 8
const RIGHT_MARGIN = 12
const COMPANION_INDICATOR_PARTITION = 'companion-indicator'

let indicatorWindow: BrowserWindow | null = null

export function getCompanionIndicatorWindow(): BrowserWindow | null {
  return indicatorWindow && !indicatorWindow.isDestroyed() ? indicatorWindow : null
}

/** Top-right corner of the display nearest the cursor, clear of the menu bar/notch — the
 *  pill sits where a system status item would, never over document content. */
export function resolveCompanionIndicatorBounds(): {
  x: number
  y: number
  width: number
  height: number
} {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x: areaX, y: areaY, width: areaWidth } = display.workArea
  return {
    x: Math.round(areaX + areaWidth - INDICATOR_WIDTH - RIGHT_MARGIN),
    y: areaY + TOP_MARGIN,
    width: INDICATOR_WIDTH,
    height: INDICATOR_HEIGHT
  }
}

function loadCompanionIndicator(window: BrowserWindow): void {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/companion-indicator.html`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/companion-indicator.html'))
  }
}

function createCompanionIndicatorWindow(): BrowserWindow {
  const bounds = resolveCompanionIndicatorBounds()
  const window = new BrowserWindow({
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Why: Hyprland (and other WMs) auto-tile new windows unless a rule matches; this
    // stable title lets a `windowrulev2 float,title:^(orca-companion-indicator)$` pin it.
    title: 'orca-companion-indicator',
    // Why: same NSPanel reasoning as companion-window.ts — showing the pill must never
    // activate Orca or pull the user out of a fullscreen Space.
    type: 'panel',
    // Why: a status indicator needs no keyboard focus; staying unfocusable keeps
    // BrowserWindow.getFocusedWindow() untouched by it appearing/disappearing.
    focusable: false,
    acceptFirstMouse: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      partition: COMPANION_INDICATOR_PARTITION,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)

  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Why click-through by default: the pill must never block clicks to whatever is underneath
  // it. The renderer reports real hover over the visible pill shape via
  // `companion:indicatorHoverChanged` (preload bridge), which toggles this back off just long
  // enough for the click to land, then re-arms it on mouseleave.
  window.setIgnoreMouseEvents(true, { forward: true })

  window.on('closed', () => {
    if (indicatorWindow === window) {
      indicatorWindow = null
    }
  })

  loadCompanionIndicator(window)
  indicatorWindow = window
  return window
}

export function ensureCompanionIndicatorWindowAlive(): BrowserWindow {
  return getCompanionIndicatorWindow() ?? createCompanionIndicatorWindow()
}

/** Shows the pill at the active display's top-right corner without ever activating Orca or
 *  changing the key window (mirrors `showCompanionPanelForNotice`). */
export function showCompanionIndicator(): void {
  const window = ensureCompanionIndicatorWindowAlive()
  window.setBounds(resolveCompanionIndicatorBounds())
  const reveal = (): void => {
    // Why: background/E2E-headless runs stay entirely off screen, same policy as the panel.
    if (!isWindowlessLaunch()) {
      window.showInactive()
    }
  }
  if (window.webContents.isLoading()) {
    window.once('ready-to-show', reveal)
  } else {
    reveal()
  }
}

export function hideCompanionIndicator(): void {
  const window = getCompanionIndicatorWindow()
  if (window && window.isVisible()) {
    window.hide()
  }
}

export function destroyCompanionIndicatorWindow(): void {
  const window = getCompanionIndicatorWindow()
  if (window) {
    window.destroy()
  }
  indicatorWindow = null
}

/** Toggles real interactivity on the otherwise click-through pill: `interactive` while the
 *  pointer is actually over its visible shape (reported by the renderer), click-through
 *  everywhere/everywhen else. */
export function setCompanionIndicatorInteractive(interactive: boolean): void {
  const window = getCompanionIndicatorWindow()
  if (window) {
    window.setIgnoreMouseEvents(!interactive, { forward: true })
  }
}

export function sendToCompanionIndicatorWindow(channel: string, ...args: unknown[]): void {
  const window = getCompanionIndicatorWindow()
  if (window && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, ...args)
  }
}
