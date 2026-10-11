import { create } from 'zustand'
import {
  WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE,
  WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES,
  type WorkspaceTimelinePersistedEntry
} from '../components/right-sidebar/workspace-timeline/workspace-timeline-types'

const STORAGE_KEY = 'orca.workspaceTimeline.v1'
// Why: trailing-edge debounce so a burst of tool-use events (many per second during a
// run) yields one disk write, not one per event.
const PERSIST_DEBOUNCE_MS = 400

export type WorkspaceTimelinePersistedState = Record<string, WorkspaceTimelinePersistedEntry[]>

function isPersistedEntry(value: unknown): value is WorkspaceTimelinePersistedEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if (
    !('kind' in value) ||
    !('id' in value) ||
    !('worktreeId' in value) ||
    !('timestamp' in value)
  ) {
    return false
  }
  return (
    (value.kind === 'prompt' || value.kind === 'state' || value.kind === 'file') &&
    typeof value.id === 'string' &&
    typeof value.worktreeId === 'string' &&
    typeof value.timestamp === 'number'
  )
}

export function readPersistedWorkspaceTimeline(): WorkspaceTimelinePersistedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    const result: WorkspaceTimelinePersistedState = {}
    for (const [worktreeId, entries] of Object.entries(parsed)) {
      if (!Array.isArray(entries)) {
        continue
      }
      const valid = entries.filter(isPersistedEntry)
      if (valid.length > 0) {
        result[worktreeId] = valid
      }
    }
    return result
  } catch {
    return {}
  }
}

function writePersistedWorkspaceTimeline(state: WorkspaceTimelinePersistedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // localStorage may be disabled or full — the in-memory timeline still works this session.
  }
}

/** Appends entries for one workspace, trims to the per-workspace cap, and evicts the
 *  least-recently-touched workspace once more than the tracked cap are present. Pure so
 *  ordering/eviction are unit-testable without the store or localStorage. */
export function appendWorkspaceTimelineEntries(
  state: WorkspaceTimelinePersistedState,
  worktreeId: string,
  newEntries: readonly WorkspaceTimelinePersistedEntry[]
): WorkspaceTimelinePersistedState {
  if (newEntries.length === 0) {
    return state
  }
  const existing = state[worktreeId] ?? []
  const merged = [...existing, ...newEntries]
  const trimmed =
    merged.length > WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE
      ? merged.slice(merged.length - WORKSPACE_TIMELINE_MAX_ENTRIES_PER_WORKTREE)
      : merged
  const next = { ...state, [worktreeId]: trimmed }
  const worktreeIds = Object.keys(next)
  if (worktreeIds.length <= WORKSPACE_TIMELINE_MAX_TRACKED_WORKTREES) {
    return next
  }
  const evictCandidates = worktreeIds.filter((id) => id !== worktreeId)
  const oldestWorktreeId = evictCandidates.reduce((oldest, id) => {
    const oldestNewest = next[oldest]?.at(-1)?.timestamp ?? 0
    const candidateNewest = next[id]?.at(-1)?.timestamp ?? 0
    return candidateNewest < oldestNewest ? id : oldest
  }, evictCandidates[0])
  const rest = { ...next }
  delete rest[oldestWorktreeId]
  return rest
}

type WorkspaceTimelineStoreState = {
  entriesByWorktreeId: WorkspaceTimelinePersistedState
  appendEntries: (worktreeId: string, entries: readonly WorkspaceTimelinePersistedEntry[]) => void
}

let persistTimer: number | null = null
function schedulePersist(state: WorkspaceTimelinePersistedState): void {
  clearTimeout(persistTimer ?? undefined)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    writePersistedWorkspaceTimeline(state)
  }, PERSIST_DEBOUNCE_MS)
}

export const useWorkspaceTimelineStore = create<WorkspaceTimelineStoreState>()((set, get) => ({
  entriesByWorktreeId: readPersistedWorkspaceTimeline(),
  appendEntries: (worktreeId, entries) => {
    const current = get().entriesByWorktreeId
    const next = appendWorkspaceTimelineEntries(current, worktreeId, entries)
    if (next === current) {
      return
    }
    set({ entriesByWorktreeId: next })
    schedulePersist(next)
  }
}))
