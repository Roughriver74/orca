import { useCallback, useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { buildAgentPromptPasteBytes } from '../../../../shared/agent-prompt-injection'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { sendRuntimePtyInput } from '@/runtime/runtime-terminal-inspection'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { AgentPromptQueueIndicator } from '../prompt-library/AgentPromptQueueIndicator'
import { expandPromptSnippetForTarget } from '../prompt-library/insert-prompt-snippet'
import { selectAgentContextPromptChips } from '../prompt-library/prompt-snippet-chip-selection'
import { useRepoPromptSnippets } from '../prompt-library/repo-prompt-snippets-loader'
import { useAgentPromptQueue } from '../prompt-library/agent-prompt-queue'

/** Reserves the chip row's height at the bottom of its pane so the terminal refits above it.
 *  Why `visible`: the row mounts as `null` until a chip or queued prompt exists, so the
 *  effect must re-run when the row element actually appears, or it floats over the terminal. */
function useReservePaneBottomSpace(visible: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const row = ref.current
    const pane = row?.parentElement
    if (!row || !pane) {
      return
    }
    const reserve = (): void => {
      pane.style.setProperty('--orca-pane-bottom-chip-row-height', `${row.offsetHeight}px`)
    }
    reserve()
    const observer = new ResizeObserver(reserve)
    observer.observe(row)
    return () => {
      observer.disconnect()
      pane.style.removeProperty('--orca-pane-bottom-chip-row-height')
    }
  }, [visible])
  return ref
}

/** Small, muted suggestion-chip row shown above/below an agent terminal pane: settings
 *  and repo-defined prompts whose `when` triggers currently hold (checkFailed, overlap,
 *  agentDone, hasIssue, hasChanges), plus the pane's queued-follow-up indicator. Hidden
 *  entirely when there is nothing to show so it never reserves dead space. */
export function AgentContextPromptChipRow({
  paneKey,
  worktreeId,
  tabId,
  leafId,
  ptyId
}: {
  paneKey: string
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string
}): React.JSX.Element | null {
  const hasAgentStatus = useAppStore((s) => paneKey in s.agentStatusByPaneKey)
  const worktreePath = useAppStore(
    (s) => findWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null
  )
  const connectionId = useAppStore((s) => {
    const worktree = findWorktreeById(s.worktreesByRepo, worktreeId)
    return worktree ? (s.repos.find((r) => r.id === worktree.repoId)?.connectionId ?? null) : null
  })
  const repoSnippets = useRepoPromptSnippets(hasAgentStatus ? worktreePath : null, connectionId)
  const chips = useAppStore(
    useShallow((s) =>
      hasAgentStatus ? selectAgentContextPromptChips(s, paneKey, worktreeId, repoSnippets) : []
    )
  )
  const queue = useAgentPromptQueue(paneKey)
  const visible = hasAgentStatus && (chips.length > 0 || queue.length > 0)
  const ref = useReservePaneBottomSpace(visible)

  const handleChipClick = useCallback(
    (body: string) => {
      void (async () => {
        const text = await expandPromptSnippetForTarget(body, { worktreeId, paneKey })
        const state = useAppStore.getState()
        sendRuntimePtyInput(state.settings, ptyId, buildAgentPromptPasteBytes(text), 'driving')
        focusTerminalTabSurface(tabId, leafId)
      })()
    },
    [leafId, paneKey, ptyId, tabId, worktreeId]
  )

  if (!visible) {
    return null
  }

  return (
    <div
      ref={ref}
      className="pane-bottom-chip-row flex flex-wrap items-center gap-1.5 border-t border-border bg-background/95 px-2 py-1.5"
      aria-label={translate('promptLibrary.chips.ariaLabel', 'Suggested prompts')}
    >
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => handleChipClick(chip.body)}
          className="rounded-full border border-border bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {chip.name}
        </button>
      ))}
      <AgentPromptQueueIndicator paneKey={paneKey} />
    </div>
  )
}
