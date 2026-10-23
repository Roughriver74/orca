import { beforeEach, describe, expect, it, vi } from 'vitest'

const { created, isWindowlessLaunchMock } = vi.hoisted(() => {
  const windows: {
    options: Electron.BrowserWindowConstructorOptions
    show: ReturnType<typeof vi.fn>
    showInactive: ReturnType<typeof vi.fn>
    setIgnoreMouseEvents: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    isLoading: boolean
  }[] = []
  return {
    created: windows,
    isWindowlessLaunchMock: vi.fn(() => false)
  }
})

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents: {
      isLoading: () => boolean
      isDestroyed: () => boolean
      send: ReturnType<typeof vi.fn>
    }
    #visible = false
    show = vi.fn()
    showInactive = vi.fn(() => {
      this.#visible = true
    })
    hide = vi.fn(() => {
      this.#visible = false
    })
    focus = vi.fn()
    setBounds = vi.fn()
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    setIgnoreMouseEvents = vi.fn()
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = () => false
    destroy = vi.fn()
    isVisible = (): boolean => this.#visible

    constructor(options: Electron.BrowserWindowConstructorOptions) {
      const record: (typeof created)[number] = {
        options,
        show: this.show,
        showInactive: this.showInactive,
        setIgnoreMouseEvents: this.setIgnoreMouseEvents,
        setBounds: this.setBounds,
        isLoading: false
      }
      created.push(record)
      this.webContents = {
        isLoading: () => record.isLoading,
        isDestroyed: () => false,
        send: vi.fn()
      }
    }
  }
  return {
    BrowserWindow: FakeBrowserWindow,
    screen: {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1440, height: 900 } })
    }
  }
})
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('./companion-window-paths', () => ({
  companionPreloadPath: () => '/app/out/preload/index.js',
  companionRendererPage: (fileName: string) => `/app/out/renderer/${fileName}`
}))
vi.mock('./foreground-activation-policy', () => ({ isWindowlessLaunch: isWindowlessLaunchMock }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))

import {
  destroyCompanionIndicatorWindow,
  ensureCompanionIndicatorWindowAlive,
  hideCompanionIndicator,
  resolveCompanionIndicatorBounds,
  setCompanionIndicatorInteractive,
  showCompanionIndicator
} from './companion-indicator-window'

beforeEach(() => {
  destroyCompanionIndicatorWindow()
  created.length = 0
  isWindowlessLaunchMock.mockReturnValue(false)
})

describe('resolveCompanionIndicatorBounds', () => {
  it('places a 120x28 pill in the top-right corner, clear of the menu bar', () => {
    expect(resolveCompanionIndicatorBounds()).toEqual({
      x: 1440 - 120 - 12,
      y: 8,
      width: 120,
      height: 28
    })
  })
})

describe('companion indicator window', () => {
  it('is a non-activating, always-on-top NSPanel', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.options.type).toBe('panel')
  })

  it('is never focusable (a status indicator needs no keyboard focus)', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.options.focusable).toBe(false)
  })

  it('is click-through by default so it never blocks the app underneath it', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true })
  })

  it('stays off the taskbar/dock and never resizes/moves like a real window', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.options.skipTaskbar).toBe(true)
    expect(created[0]!.options.resizable).toBe(false)
    expect(created[0]!.options.movable).toBe(false)
  })

  it('runs its own partition, separate from the big panel', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.options.webPreferences?.partition).toBe('companion-indicator')
  })

  it('carries a stable title a Hyprland rule can match to float/pin it', () => {
    ensureCompanionIndicatorWindowAlive()
    expect(created[0]!.options.title).toBe('orca-companion-indicator')
  })
})

describe('showCompanionIndicator / hideCompanionIndicator', () => {
  it('shows inactively and hides again', () => {
    showCompanionIndicator()
    expect(created[0]!.showInactive).toHaveBeenCalledTimes(1)
    hideCompanionIndicator()
  })

  it('never reveals under a windowless/background launch', () => {
    isWindowlessLaunchMock.mockReturnValue(true)
    showCompanionIndicator()
    expect(created[0]!.showInactive).not.toHaveBeenCalled()
  })
})

describe('setCompanionIndicatorInteractive', () => {
  it('flips ignoreMouseEvents off while interactive (hovered), back on otherwise', () => {
    ensureCompanionIndicatorWindowAlive()
    created[0]!.setIgnoreMouseEvents.mockClear()

    setCompanionIndicatorInteractive(true)
    expect(created[0]!.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })

    setCompanionIndicatorInteractive(false)
    expect(created[0]!.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })
  })
})
