// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileExplorerImport } from './useFileExplorerImport'

const mocks = vi.hoisted(() => ({
  importPaths: vi.fn(),
  captureGuard: vi.fn(),
  readClipboardFilePaths: vi.fn(),
  toastError: vi.fn()
}))
vi.mock('@/runtime/runtime-file-client', () => ({
  importExternalPathsToRuntime: mocks.importPaths
}))
vi.mock('./file-explorer-operation-owner', () => ({
  captureFileExplorerOperationGuard: mocks.captureGuard
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

const refreshDir = vi.fn().mockResolvedValue(undefined)
const clearDrag = vi.fn()
const setSelected = vi.fn()

function PasteProbe({
  onReady
}: {
  onReady: (paste: (dir: string) => Promise<void>) => void
}): null {
  const { pasteFilesFromClipboard } = useFileExplorerImport({
    worktreeId: 'wt-a',
    worktreePath: '/repo',
    displayRootPath: '/repo',
    refreshDir,
    clearNativeDragState: clearDrag,
    setSelectedPath: setSelected
  })
  onReady(pasteFilesFromClipboard)
  return null
}

function renderPaste(): (dir: string) => Promise<void> {
  let paste: ((dir: string) => Promise<void>) | undefined
  render(<PasteProbe onReady={(p) => (paste = p)} />)
  if (!paste) {
    throw new Error('pasteFilesFromClipboard was not captured')
  }
  return paste
}

beforeEach(() => {
  mocks.captureGuard.mockImplementation(() => ({
    route: { settings: { activeRuntimeEnvironmentId: null }, expectedExecutionHostId: 'local' },
    assertCurrent: vi.fn()
  }))
  vi.stubGlobal('api', { ui: { readClipboardFilePaths: mocks.readClipboardFilePaths } })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('pasteFilesFromClipboard', () => {
  it('imports clipboard paths into the given destinationDir and refreshes it', async () => {
    mocks.readClipboardFilePaths.mockResolvedValue(['/Users/me/a.txt', '/Users/me/b.txt'])
    mocks.importPaths.mockResolvedValue({
      results: [{ status: 'imported', destPath: '/repo/docs/a.txt' }]
    })
    const paste = renderPaste()

    await act(async () => {
      await paste('/repo/docs')
    })

    expect(mocks.importPaths).toHaveBeenCalledWith(
      expect.objectContaining({ worktreeId: 'wt-a', worktreePath: '/repo' }),
      ['/Users/me/a.txt', '/Users/me/b.txt'],
      '/repo/docs',
      expect.any(Object)
    )
    expect(refreshDir).toHaveBeenCalledWith('/repo/docs')
    expect(setSelected).toHaveBeenCalledWith('/repo/docs/a.txt')
  })

  it('no-ops when the clipboard holds no files', async () => {
    mocks.readClipboardFilePaths.mockResolvedValue([])
    const paste = renderPaste()

    await act(async () => {
      await paste('/repo/docs')
    })

    expect(mocks.captureGuard).not.toHaveBeenCalled()
    expect(mocks.importPaths).not.toHaveBeenCalled()
    expect(refreshDir).not.toHaveBeenCalled()
  })

  it('surfaces a failure toast on partial failure, same as the drop path', async () => {
    mocks.readClipboardFilePaths.mockResolvedValue(['/Users/me/a.txt', '/Users/me/b.txt'])
    mocks.importPaths.mockResolvedValue({
      results: [
        { status: 'imported', destPath: '/repo/docs/a.txt' },
        { status: 'failed', destPath: '/repo/docs/b.txt' }
      ]
    })
    const paste = renderPaste()

    await act(async () => {
      await paste('/repo/docs')
    })

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to import 1 file.')
  })

  it('surfaces a skipped toast when every result was skipped, same as the drop path', async () => {
    mocks.readClipboardFilePaths.mockResolvedValue(['/Users/me/a.txt'])
    mocks.importPaths.mockResolvedValue({
      results: [{ status: 'skipped', destPath: '/repo/docs/a.txt' }]
    })
    const paste = renderPaste()

    await act(async () => {
      await paste('/repo/docs')
    })

    expect(mocks.toastError).toHaveBeenCalledWith('Skipped 1 file.')
  })
})
