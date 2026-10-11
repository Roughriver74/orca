// @vitest-environment happy-dom
import { createElement, createRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFileExplorerRowProjection } from './file-explorer-row-projection'
import type { InlineInput } from './file-explorer-inline-input-row'
import type { TreeNode } from './file-explorer-types'
import { useFileExplorerKeys } from './useFileExplorerKeys'

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      rightSidebarOpen: true,
      rightSidebarTab: 'explorer',
      rightSidebarExplorerView: 'files',
      keybindings: {}
    })
}))

const folderNode: TreeNode = {
  name: 'src',
  path: '/repo/src',
  relativePath: 'src',
  isDirectory: true,
  depth: 0
}
const fileNode: TreeNode = {
  name: 'a.ts',
  path: '/repo/src/a.ts',
  relativePath: 'src/a.ts',
  isDirectory: false,
  depth: 1
}

function Probe({
  selectedNode,
  inlineInput,
  pasteFilesFromClipboard,
  platform
}: {
  selectedNode: TreeNode | null
  inlineInput: InlineInput | null
  pasteFilesFromClipboard: (dir: string) => Promise<void>
  platform: 'darwin' | 'linux'
}) {
  const containerRef = createRef<HTMLDivElement>()
  vi.stubGlobal('navigator', { userAgent: platform === 'darwin' ? 'Mac' : 'Linux' })
  useFileExplorerKeys({
    containerRef,
    rowProjection: createFileExplorerRowProjection([]),
    expandedPaths: new Set(),
    canToggleDirectories: true,
    inlineInput,
    selectedPaths: new Set(),
    selectedNode,
    activateNode: vi.fn(),
    moveSelection: vi.fn(),
    toggleDir: vi.fn(),
    startRename: vi.fn(),
    requestDelete: vi.fn(),
    requestDeleteAll: vi.fn(),
    scrollToIndex: vi.fn(),
    activeWorktreeId: 'wt-1',
    displayRootPath: '/repo',
    pasteFilesFromClipboard
  })
  return createElement('div', { ref: containerRef, tabIndex: -1, 'data-testid': 'container' })
}

function pressPaste(platform: 'darwin' | 'linux'): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'v',
      metaKey: platform === 'darwin',
      ctrlKey: platform !== 'darwin',
      bubbles: true,
      cancelable: true
    })
  )
}

describe('useFileExplorerKeys paste shortcut', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('pastes into the selected folder when the container has focus (Mac)', () => {
    const pasteFilesFromClipboard = vi.fn().mockResolvedValue(undefined)
    const view = render(
      createElement(Probe, {
        selectedNode: folderNode,
        inlineInput: null,
        pasteFilesFromClipboard,
        platform: 'darwin'
      })
    )
    act(() => {
      view.getByTestId('container').focus()
    })
    act(() => {
      pressPaste('darwin')
    })
    expect(pasteFilesFromClipboard).toHaveBeenCalledWith('/repo/src')
  })

  it('pastes into the parent dir when a file is selected (Linux Ctrl+V)', () => {
    const pasteFilesFromClipboard = vi.fn().mockResolvedValue(undefined)
    const view = render(
      createElement(Probe, {
        selectedNode: fileNode,
        inlineInput: null,
        pasteFilesFromClipboard,
        platform: 'linux'
      })
    )
    act(() => {
      view.getByTestId('container').focus()
    })
    act(() => {
      pressPaste('linux')
    })
    expect(pasteFilesFromClipboard).toHaveBeenCalledWith('/repo/src')
  })

  it('pastes into the displayed root when nothing is selected', () => {
    const pasteFilesFromClipboard = vi.fn().mockResolvedValue(undefined)
    const view = render(
      createElement(Probe, {
        selectedNode: null,
        inlineInput: null,
        pasteFilesFromClipboard,
        platform: 'darwin'
      })
    )
    act(() => {
      view.getByTestId('container').focus()
    })
    act(() => {
      pressPaste('darwin')
    })
    expect(pasteFilesFromClipboard).toHaveBeenCalledWith('/repo')
  })

  it('is a no-op when an inline input (rename/new-file) is active', () => {
    const pasteFilesFromClipboard = vi.fn().mockResolvedValue(undefined)
    const view = render(
      createElement(Probe, {
        selectedNode: folderNode,
        inlineInput: { type: 'file', depth: 0, parentPath: '/repo' },
        pasteFilesFromClipboard,
        platform: 'darwin'
      })
    )
    act(() => {
      view.getByTestId('container').focus()
    })
    act(() => {
      pressPaste('darwin')
    })
    expect(pasteFilesFromClipboard).not.toHaveBeenCalled()
  })

  it('is a no-op when the container does not have focus', () => {
    const pasteFilesFromClipboard = vi.fn().mockResolvedValue(undefined)
    render(
      createElement(Probe, {
        selectedNode: folderNode,
        inlineInput: null,
        pasteFilesFromClipboard,
        platform: 'darwin'
      })
    )
    act(() => {
      pressPaste('darwin')
    })
    expect(pasteFilesFromClipboard).not.toHaveBeenCalled()
  })
})
