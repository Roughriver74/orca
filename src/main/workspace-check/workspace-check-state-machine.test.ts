import { describe, expect, it } from 'vitest'
import {
  stepWorkspaceCheckRunner,
  type WorkspaceCheckRunnerState
} from './workspace-check-state-machine'

const idle: WorkspaceCheckRunnerState = { phase: 'idle' }

describe('stepWorkspaceCheckRunner', () => {
  it('runs the happy path: finish, debounce elapses, run finishes', () => {
    const afterFinish = stepWorkspaceCheckRunner(idle, { type: 'agent-finished' })
    expect(afterFinish).toEqual({ state: { phase: 'debouncing' }, effects: ['start-debounce'] })

    const afterDebounce = stepWorkspaceCheckRunner(afterFinish.state, { type: 'debounce-elapsed' })
    expect(afterDebounce).toEqual({ state: { phase: 'running' }, effects: ['start-run'] })

    const afterRun = stepWorkspaceCheckRunner(afterDebounce.state, { type: 'run-finished' })
    expect(afterRun).toEqual({ state: { phase: 'idle' }, effects: [] })
  })

  it('cancels the pending debounce when the agent resumes working mid-debounce, without ever running', () => {
    const debouncing = stepWorkspaceCheckRunner(idle, { type: 'agent-finished' }).state
    const resumed = stepWorkspaceCheckRunner(debouncing, { type: 'agent-working' })
    expect(resumed).toEqual({ state: { phase: 'busy' }, effects: ['cancel-debounce'] })

    // The stale timer eventually fires anyway; it must not start a run.
    const stale = stepWorkspaceCheckRunner(resumed.state, { type: 'debounce-elapsed' })
    expect(stale).toEqual({ state: { phase: 'busy' }, effects: [] })
  })

  it('cancels an in-flight run when the agent resumes working mid-run', () => {
    const running: WorkspaceCheckRunnerState = { phase: 'running' }
    const resumed = stepWorkspaceCheckRunner(running, { type: 'agent-working' })
    expect(resumed).toEqual({ state: { phase: 'busy' }, effects: ['cancel-run'] })
  })

  it('ignores a stale debounce-elapsed that arrives after a cancel', () => {
    const busy: WorkspaceCheckRunnerState = { phase: 'busy' }
    const result = stepWorkspaceCheckRunner(busy, { type: 'debounce-elapsed' })
    expect(result).toEqual({ state: busy, effects: [] })
  })

  it('ignores a stale run-finished that arrives after a cancel', () => {
    const busy: WorkspaceCheckRunnerState = { phase: 'busy' }
    const result = stepWorkspaceCheckRunner(busy, { type: 'run-finished' })
    expect(result).toEqual({ state: busy, effects: [] })
  })

  it('starts a manual run immediately while idle', () => {
    const result = stepWorkspaceCheckRunner(idle, { type: 'manual-run-requested' })
    expect(result).toEqual({ state: { phase: 'running' }, effects: ['start-run'] })
  })

  it('cancels the pending debounce before starting a manual run', () => {
    const debouncing = stepWorkspaceCheckRunner(idle, { type: 'agent-finished' }).state
    const result = stepWorkspaceCheckRunner(debouncing, { type: 'manual-run-requested' })
    expect(result).toEqual({
      state: { phase: 'running' },
      effects: ['cancel-debounce', 'start-run']
    })
  })

  it('cancels and restarts an already-running check on a manual run request', () => {
    const running: WorkspaceCheckRunnerState = { phase: 'running' }
    const result = stepWorkspaceCheckRunner(running, { type: 'manual-run-requested' })
    expect(result).toEqual({
      state: { phase: 'running' },
      effects: ['cancel-run', 'start-run']
    })
  })

  it('does not double-schedule a debounce on a duplicate agent-finished event', () => {
    const debouncing = stepWorkspaceCheckRunner(idle, { type: 'agent-finished' }).state
    const duplicate = stepWorkspaceCheckRunner(debouncing, { type: 'agent-finished' })
    expect(duplicate).toEqual({ state: { phase: 'debouncing' }, effects: [] })
  })
})
