// ─── Pure state machine for the per-workspace "Check command" runner ────────
// No timers, no I/O: the engine (workspace-check-service.ts) interprets the emitted
// effects (schedule/cancel a debounce, start/cancel a run) against real timers/processes,
// which keeps the transition table itself exhaustively unit-testable.

export type WorkspaceCheckRunnerPhase = 'idle' | 'busy' | 'debouncing' | 'running'

export type WorkspaceCheckRunnerState = {
  phase: WorkspaceCheckRunnerPhase
}

export type WorkspaceCheckRunnerEvent =
  | { type: 'agent-working' }
  | { type: 'agent-finished' }
  | { type: 'debounce-elapsed' }
  | { type: 'run-finished' }
  | { type: 'manual-run-requested' }

export type WorkspaceCheckRunnerEffect =
  | 'start-debounce'
  | 'cancel-debounce'
  | 'start-run'
  | 'cancel-run'

export function stepWorkspaceCheckRunner(
  state: WorkspaceCheckRunnerState,
  event: WorkspaceCheckRunnerEvent
): { state: WorkspaceCheckRunnerState; effects: WorkspaceCheckRunnerEffect[] } {
  const noop: { state: WorkspaceCheckRunnerState; effects: WorkspaceCheckRunnerEffect[] } = {
    state,
    effects: []
  }

  switch (event.type) {
    case 'agent-working': {
      switch (state.phase) {
        case 'idle':
        case 'busy':
          return { state: { phase: 'busy' }, effects: [] }
        case 'debouncing':
          return { state: { phase: 'busy' }, effects: ['cancel-debounce'] }
        case 'running':
          return { state: { phase: 'busy' }, effects: ['cancel-run'] }
      }
      break
    }
    case 'agent-finished': {
      switch (state.phase) {
        case 'idle':
        case 'busy':
          return { state: { phase: 'debouncing' }, effects: ['start-debounce'] }
        case 'debouncing':
        case 'running':
          // Duplicate finish signal (debouncing) or a finish observed while a prior run is
          // still in flight (running): neither re-arms anything already scheduled.
          return noop
      }
      break
    }
    case 'debounce-elapsed': {
      // A timer that lost its race against a cancel (agent resumed working, or a manual
      // run already started one) arrives for a phase other than `debouncing`: stale, no-op.
      if (state.phase !== 'debouncing') {
        return noop
      }
      return { state: { phase: 'running' }, effects: ['start-run'] }
    }
    case 'run-finished': {
      // A cancelled run's eventual completion arrives after the phase moved on: stale, no-op.
      if (state.phase !== 'running') {
        return noop
      }
      return { state: { phase: 'idle' }, effects: [] }
    }
    case 'manual-run-requested': {
      switch (state.phase) {
        case 'idle':
        case 'busy':
          return { state: { phase: 'running' }, effects: ['start-run'] }
        case 'debouncing':
          return { state: { phase: 'running' }, effects: ['cancel-debounce', 'start-run'] }
        case 'running':
          return { state: { phase: 'running' }, effects: ['cancel-run', 'start-run'] }
      }
      break
    }
  }
  return noop
}
