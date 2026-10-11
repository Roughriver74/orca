import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getRuntimeGitReviewedChanges,
  markRuntimeGitReviewed,
  type RuntimeGitContext
} from '@/runtime/runtime-git-client'
import type { GitReviewedChangesResult } from '../../../../../../shared/git-reviewed-types'

export type ReviewedChangesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: GitReviewedChangesResult }
  | { status: 'error'; error: string }

const IDLE_STATE: ReviewedChangesState = { status: 'idle' }

/**
 * Loads the "since review" compare for the active worktree, mirroring `useSourceControlGitHistory`:
 * kept per-worktree so switching tabs restores the previous result, and re-fetched on
 * `markReviewed`, an explicit `refreshReviewedChanges` call, or a change in the polled git status.
 */
export function useSourceControlReviewedChanges({
  activeRepoSettings,
  activeWorktreeId,
  worktreePath,
  isFolder,
  connectionId,
  statusFingerprint
}: {
  activeRepoSettings: RuntimeGitContext['settings']
  activeWorktreeId: string | null
  worktreePath: string | null
  isFolder: boolean
  connectionId: string | null
  /** Changes whenever the polled working-tree status changes (paths, areas, line counts). */
  statusFingerprint: string
}): {
  reviewedChangesState: ReviewedChangesState
  isMarkingReviewed: boolean
  markReviewed: () => Promise<void>
  refreshReviewedChanges: () => Promise<void>
} {
  const [stateByWorktree, setStateByWorktree] = useState<Record<string, ReviewedChangesState>>({})
  const [isMarkingReviewed, setIsMarkingReviewed] = useState(false)
  const requestSeqByWorktreeRef = useRef<Record<string, number>>({})
  const state = activeWorktreeId ? (stateByWorktree[activeWorktreeId] ?? IDLE_STATE) : IDLE_STATE

  const buildContext = useCallback((): RuntimeGitContext | null => {
    if (!worktreePath) {
      return null
    }
    return {
      settings: activeRepoSettings,
      worktreeId: activeWorktreeId,
      worktreePath,
      connectionId: connectionId ?? undefined
    }
  }, [activeRepoSettings, activeWorktreeId, connectionId, worktreePath])

  const refreshReviewedChanges = useCallback(async (): Promise<void> => {
    const context = buildContext()
    const worktreeId = activeWorktreeId
    if (!context || !worktreeId || isFolder) {
      return
    }
    const seq = (requestSeqByWorktreeRef.current[worktreeId] ?? 0) + 1
    requestSeqByWorktreeRef.current[worktreeId] = seq
    // Why: background refreshes keep the current list instead of flashing a loading state.
    setStateByWorktree((prev) =>
      prev[worktreeId]?.status === 'ready' ? prev : { ...prev, [worktreeId]: { status: 'loading' } }
    )
    try {
      const result = await getRuntimeGitReviewedChanges(context)
      if (requestSeqByWorktreeRef.current[worktreeId] !== seq) {
        return
      }
      setStateByWorktree((prev) => ({ ...prev, [worktreeId]: { status: 'ready', result } }))
    } catch (error) {
      if (requestSeqByWorktreeRef.current[worktreeId] !== seq) {
        return
      }
      setStateByWorktree((prev) => ({
        ...prev,
        [worktreeId]: {
          status: 'error',
          error: error instanceof Error ? error.message : 'Failed to load changes since review'
        }
      }))
    }
  }, [activeWorktreeId, buildContext, isFolder])

  const markReviewed = useCallback(async (): Promise<void> => {
    const context = buildContext()
    if (!context || isFolder) {
      return
    }
    setIsMarkingReviewed(true)
    try {
      await markRuntimeGitReviewed(context)
      await refreshReviewedChanges()
    } finally {
      setIsMarkingReviewed(false)
    }
  }, [buildContext, isFolder, refreshReviewedChanges])

  const refreshReviewedChangesRef = useRef(refreshReviewedChanges)
  // Why: publish in an effect, not the render body — a discarded render must not install its callback.
  useEffect(() => {
    refreshReviewedChangesRef.current = refreshReviewedChanges
  }, [refreshReviewedChanges])

  useEffect(() => {
    if (!activeWorktreeId || isFolder || stateByWorktree[activeWorktreeId]) {
      return
    }
    void refreshReviewedChangesRef.current()
  }, [activeWorktreeId, isFolder, stateByWorktree])

  const lastFingerprintByWorktreeRef = useRef<Record<string, string>>({})
  useEffect(() => {
    if (!activeWorktreeId || isFolder) {
      return
    }
    const previous = lastFingerprintByWorktreeRef.current[activeWorktreeId]
    lastFingerprintByWorktreeRef.current[activeWorktreeId] = statusFingerprint
    if (previous !== undefined && previous !== statusFingerprint) {
      void refreshReviewedChangesRef.current()
    }
  }, [activeWorktreeId, isFolder, statusFingerprint])

  return {
    reviewedChangesState: state,
    isMarkingReviewed,
    markReviewed,
    refreshReviewedChanges
  }
}
