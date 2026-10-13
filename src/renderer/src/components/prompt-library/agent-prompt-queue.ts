import { useSyncExternalStore } from 'react'
import { createBrowserUuid } from '@/lib/browser-uuid'

// ─── Per-pane agent follow-up prompt queue ──────────────────────────────────
// In-memory only (not persisted, not part of the zustand store): a pane's queued
// prompts are meaningless once the renderer reloads mid-agent-turn, and persisting
// them would risk re-sending a stale follow-up into a different agent session.

export type AgentPromptQueueItem = { id: string; text: string }

type QueueRecord = { worktreeId: string; items: readonly AgentPromptQueueItem[] }

const EMPTY_ITEMS: readonly AgentPromptQueueItem[] = Object.freeze([])

const queuesByPaneKey = new Map<string, QueueRecord>()
const listenersByPaneKey = new Map<string, Set<() => void>>()

function notify(paneKey: string): void {
  const listeners = listenersByPaneKey.get(paneKey)
  if (!listeners) {
    return
  }
  for (const listener of listeners) {
    listener()
  }
}

/** Queues `text` behind `paneKey`'s other pending follow-ups; sent once that pane's
 *  agent next finishes a (non-interrupted) turn. `worktreeId` is refreshed on every
 *  call so the most recent enqueue's worktree wins if a pane were ever reused. */
export function enqueueAgentPrompt(args: { paneKey: string; worktreeId: string; text: string }): void {
  const { paneKey, worktreeId, text } = args
  const trimmed = text.trim()
  if (!trimmed) {
    return
  }
  const existing = queuesByPaneKey.get(paneKey)
  const item: AgentPromptQueueItem = { id: createBrowserUuid(), text: trimmed }
  queuesByPaneKey.set(paneKey, {
    worktreeId,
    items: existing ? [...existing.items, item] : [item]
  })
  notify(paneKey)
}

export function clearAgentPromptQueue(paneKey: string): void {
  if (!queuesByPaneKey.has(paneKey)) {
    return
  }
  queuesByPaneKey.delete(paneKey)
  notify(paneKey)
}

export function useAgentPromptQueue(paneKey: string): readonly AgentPromptQueueItem[] {
  return useSyncExternalStore(
    (listener) => {
      let listeners = listenersByPaneKey.get(paneKey)
      if (!listeners) {
        listeners = new Set()
        listenersByPaneKey.set(paneKey, listeners)
      }
      listeners.add(listener)
      return () => {
        listeners?.delete(listener)
        if (listeners?.size === 0) {
          listenersByPaneKey.delete(paneKey)
        }
      }
    },
    () => queuesByPaneKey.get(paneKey)?.items ?? EMPTY_ITEMS
  )
}

// ─── Internal API for the auto-submit subscriber (agent-prompt-queue-auto-submit.ts) ──

/** The head item of `paneKey`'s queue, with the worktree it should be sent into. */
export function peekAgentPromptQueueHead(
  paneKey: string
): { worktreeId: string; item: AgentPromptQueueItem } | null {
  const record = queuesByPaneKey.get(paneKey)
  if (!record || record.items.length === 0) {
    return null
  }
  return { worktreeId: record.worktreeId, item: record.items[0] }
}

/** Drops the head item after it was successfully submitted. */
export function dequeueAgentPromptHead(paneKey: string): void {
  const record = queuesByPaneKey.get(paneKey)
  if (!record || record.items.length === 0) {
    return
  }
  const items = record.items.slice(1)
  if (items.length === 0) {
    queuesByPaneKey.delete(paneKey)
  } else {
    queuesByPaneKey.set(paneKey, { worktreeId: record.worktreeId, items })
  }
  notify(paneKey)
}

/** All pane keys with a non-empty queue, for sweeping queues whose pane disappeared. */
export function listQueuedPaneKeys(): readonly string[] {
  return [...queuesByPaneKey.keys()]
}
