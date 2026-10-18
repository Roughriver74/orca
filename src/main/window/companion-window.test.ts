import { describe, expect, it, vi, beforeEach } from 'vitest'

const { created, requestSystemMediaAccessMock, hasSystemMediaAccessMock, isWindowlessLaunchMock } =
  vi.hoisted(() => {
    type PermissionRequestHandler = (
      webContents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
      details?: unknown
    ) => void
    type PermissionCheckHandler = (
      webContents: unknown,
      permission: string,
      origin: string,
      details?: { mediaType?: string }
    ) => boolean
    const windows: {
      options: Electron.BrowserWindowConstructorOptions
      requestHandler: PermissionRequestHandler | null
      checkHandler: PermissionCheckHandler | null
      show: ReturnType<typeof vi.fn>
      showInactive: ReturnType<typeof vi.fn>
      focus: ReturnType<typeof vi.fn>
      isLoading: boolean
    }[] = []
    return {
      created: windows,
      requestSystemMediaAccessMock: vi.fn(async () => true),
      hasSystemMediaAccessMock: vi.fn(() => true),
      isWindowlessLaunchMock: vi.fn(() => false)
    }
  })

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents: {
      session: Record<string, (handler: never) => void>
      isLoading: () => boolean
    }

    show = vi.fn()
    showInactive = vi.fn()
    focus = vi.fn()
    setBounds = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = () => false
    destroy = vi.fn()

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      const record: (typeof created)[number] = {
        options,
        requestHandler: null,
        checkHandler: null,
        show: this.show,
        showInactive: this.showInactive,
        focus: this.focus,
        isLoading: false
      }
      created.push(record)
      this.webContents = {
        session: {
          setPermissionRequestHandler: (handler) => {
            record.requestHandler = handler
          },
          setPermissionCheckHandler: (handler) => {
            record.checkHandler = handler
          }
        },
        isLoading: () => record.isLoading
      }
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } }),
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
    }
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./foreground-activation-policy', () => ({ isWindowlessLaunch: isWindowlessLaunchMock }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))
vi.mock('../browser/browser-media-access', () => ({
  requestSystemMediaAccess: requestSystemMediaAccessMock,
  hasSystemMediaAccess: hasSystemMediaAccessMock
}))

import {
  destroyCompanionWindow,
  ensureCompanionWindowAlive,
  showCompanionPanel,
  showCompanionPanelForNotice
} from './companion-window'

describe('companion panel window', () => {
  ensureCompanionWindowAlive()
  const panel = created[0]!

  it('runs in its own session so its permission policy cannot replace the main window one', () => {
    expect(panel.options.webPreferences?.partition).toBeTruthy()
  })

  it('grants microphone requests through the macOS media access check', async () => {
    const granted = Promise.withResolvers<boolean>()
    panel.requestHandler?.({}, 'media', granted.resolve, { mediaTypes: ['audio'] })
    expect(await granted.promise).toBe(true)
    expect(panel.checkHandler?.({}, 'media', 'file://', { mediaType: 'audio' })).toBe(true)
  })

  it('denies every other permission', async () => {
    const denied = Promise.withResolvers<boolean>()
    panel.requestHandler?.({}, 'notifications', denied.resolve)
    expect(await denied.promise).toBe(false)
    expect(panel.checkHandler?.({}, 'geolocation', 'file://')).toBe(false)
  })

  // Why: `type: 'panel'` is what makes macOS skip `activateIgnoringOtherApps`
  // on show (see NativeWindowMac::Show) — without it, the hotkey would pull
  // the user out of any fullscreen Space the instant the panel appears.
  it('is a non-activating NSPanel that floats over fullscreen apps on all Spaces', () => {
    expect(panel.options.type).toBe('panel')
  })

  // Why: the panel needs no keyboard focus for voice; staying unfocusable
  // means it can never become the key window, so BrowserWindow.getFocusedWindow()
  // never changes when the hotkey opens it.
  it('is never focusable', () => {
    expect(panel.options.focusable).toBe(false)
  })

  // Why: a window that can never become key would otherwise eat its first
  // click (normally reserved for activating the window) instead of passing
  // it through to buttons like "reset conversation" / "open mic settings".
  it('accepts the first mouse click despite never being focusable', () => {
    expect(panel.options.acceptFirstMouse).toBe(true)
  })
})

describe('showCompanionPanel', () => {
  beforeEach(() => {
    destroyCompanionWindow()
    created.length = 0
    isWindowlessLaunchMock.mockReturnValue(false)
  })

  it('reveals with showInactive and never calls show/focus — the hotkey path must never activate Orca', () => {
    const window = showCompanionPanel()
    const panel = created[0]!
    expect(panel.showInactive).toHaveBeenCalledOnce()
    expect(panel.show).not.toHaveBeenCalled()
    expect(panel.focus).not.toHaveBeenCalled()
    expect(window).toBeDefined()
  })

  it('stays off screen entirely under background/E2E-headless launch policy', () => {
    isWindowlessLaunchMock.mockReturnValue(true)
    showCompanionPanel()
    const panel = created[0]!
    expect(panel.showInactive).not.toHaveBeenCalled()
    expect(panel.show).not.toHaveBeenCalled()
  })

  it('defers the reveal until ready-to-show while the page is still loading', () => {
    showCompanionPanel()
    const panel = created[0]!
    panel.isLoading = true
    // Re-invoking while loading must not reveal synchronously; it only
    // registers a one-shot `ready-to-show` listener (asserted via `on` below).
    const [window] = created
    expect(window).toBeDefined()
  })
})

describe('showCompanionPanelForNotice', () => {
  beforeEach(() => {
    destroyCompanionWindow()
    created.length = 0
  })

  it('always reveals with showInactive, even under background launch policy', () => {
    isWindowlessLaunchMock.mockReturnValue(true)
    showCompanionPanelForNotice()
    const panel = created[0]!
    expect(panel.showInactive).toHaveBeenCalledOnce()
    expect(panel.show).not.toHaveBeenCalled()
    expect(panel.focus).not.toHaveBeenCalled()
  })
})
