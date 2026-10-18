import { describe, expect, it, vi } from 'vitest'

const { created, requestSystemMediaAccessMock, hasSystemMediaAccessMock } = vi.hoisted(() => {
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
  }[] = []
  return {
    created: windows,
    requestSystemMediaAccessMock: vi.fn(async () => true),
    hasSystemMediaAccessMock: vi.fn(() => true)
  }
})

vi.mock('electron', () => {
  class FakeBrowserWindow {
    webContents: { session: Record<string, (handler: never) => void> }
    constructor(options: Electron.BrowserWindowConstructorOptions) {
      const record: (typeof created)[number] = { options, requestHandler: null, checkHandler: null }
      created.push(record)
      this.webContents = {
        session: {
          setPermissionRequestHandler: (handler) => {
            record.requestHandler = handler
          },
          setPermissionCheckHandler: (handler) => {
            record.checkHandler = handler
          }
        }
      }
    }
    setAlwaysOnTop = vi.fn()
    setVisibleOnAllWorkspaces = vi.fn()
    on = vi.fn()
    loadFile = vi.fn()
    loadURL = vi.fn()
    isDestroyed = () => false
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
vi.mock('./foreground-activation-policy', () => ({ showWindowWithoutStealingFocus: vi.fn() }))
vi.mock('./privileged-window-navigation', () => ({
  installPrivilegedWindowNavigationPolicy: vi.fn()
}))
vi.mock('../browser/browser-media-access', () => ({
  requestSystemMediaAccess: requestSystemMediaAccessMock,
  hasSystemMediaAccess: hasSystemMediaAccessMock
}))

import { ensureCompanionWindowAlive } from './companion-window'

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
})
