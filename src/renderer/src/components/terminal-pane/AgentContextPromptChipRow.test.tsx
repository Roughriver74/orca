// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chipState = vi.hoisted(() => ({
  chips: [] as { id: string; name: string; body: string }[]
}))

vi.mock('@/store', () => {
  const state = { agentStatusByPaneKey: { pane: {} }, worktreesByRepo: {}, repos: [] }
  const useAppStore = (selector: (s: typeof state) => unknown): unknown => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('@/store/slices/worktree-helpers', () => ({ findWorktreeById: () => null }))
vi.mock('../prompt-library/prompt-snippet-chip-selection', () => ({
  selectAgentContextPromptChips: () => chipState.chips
}))
vi.mock('../prompt-library/repo-prompt-snippets-loader', () => ({
  useRepoPromptSnippets: () => []
}))
vi.mock('../prompt-library/agent-prompt-queue', () => ({ useAgentPromptQueue: () => [] }))
vi.mock('../prompt-library/AgentPromptQueueIndicator', () => ({
  AgentPromptQueueIndicator: () => null
}))

import { AgentContextPromptChipRow } from './AgentContextPromptChipRow'

const RESERVED = '--orca-pane-bottom-chip-row-height'

describe('AgentContextPromptChipRow', () => {
  let pane: HTMLDivElement
  let root: Root

  beforeEach(() => {
    chipState.chips = []
    pane = document.createElement('div')
    document.body.appendChild(pane)
    root = createRoot(pane)
  })

  afterEach(() => {
    act(() => root.unmount())
    pane.remove()
  })

  const renderRow = (): void => {
    act(() => {
      root.render(
        <AgentContextPromptChipRow
          paneKey="pane"
          worktreeId="wt"
          tabId="tab"
          leafId="leaf"
          ptyId="pty"
        />
      )
    })
  }

  // The terminal only refits above the row when the pane carries the reserved height.
  it('reserves pane space when chips appear after an empty first render', () => {
    renderRow()
    expect(pane.style.getPropertyValue(RESERVED)).toBe('')

    chipState.chips = [{ id: 'overlap', name: 'Coordinate overlapping files', body: 'x' }]
    renderRow()
    expect(pane.querySelector('.pane-bottom-chip-row')).not.toBeNull()
    expect(pane.style.getPropertyValue(RESERVED)).toMatch(/^\d+px$/)

    chipState.chips = []
    renderRow()
    expect(pane.style.getPropertyValue(RESERVED)).toBe('')
  })
})
