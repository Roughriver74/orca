import { describe, expect, it } from 'vitest'
import {
  decideWorkspaceCheckAutoFix,
  WORKSPACE_CHECK_AUTO_FIX_MAX_ATTEMPTS,
  type WorkspaceCheckAutoFixAgentPane,
  type WorkspaceCheckAutoFixDecisionInput
} from './workspace-check-auto-fix-decision'

const donePane = (paneKey: string, stateStartedAt: number): WorkspaceCheckAutoFixAgentPane => ({
  paneKey,
  state: 'done',
  stateStartedAt
})

const baseInput: WorkspaceCheckAutoFixDecisionInput = {
  result: { status: 'failed', exitCode: 1, error: null, finishedAt: 100 },
  lastProcessedFinishedAt: null,
  repoCheckAutoFix: true,
  attemptCount: 0,
  agentPanes: [donePane('tab:leaf-1', 10)]
}

describe('decideWorkspaceCheckAutoFix', () => {
  it('submits a prompt to the done pane with the greatest stateStartedAt', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      agentPanes: [donePane('tab:leaf-1', 10), donePane('tab:leaf-2', 20)]
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({
      type: 'submit-prompt',
      finishedAt: 100,
      paneKey: 'tab:leaf-2'
    })
  })

  it('dedupes by finishedAt: ignores a result already processed', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      lastProcessedFinishedAt: 100
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('ignores a result still running (finishedAt null)', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      result: { status: 'running', exitCode: null, error: null, finishedAt: null }
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('ignores a failure where the process never ran (exitCode null, error set)', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      result: { status: 'failed', exitCode: null, error: 'SSH target is not connected.', finishedAt: 100 }
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('skips when the repo toggle is off', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = { ...baseInput, repoCheckAutoFix: false }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('reports limit-reached once the attempt count hits the max, instead of submitting', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      attemptCount: WORKSPACE_CHECK_AUTO_FIX_MAX_ATTEMPTS
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'limit-reached', finishedAt: 100 })
  })

  it('still submits just below the limit', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      attemptCount: WORKSPACE_CHECK_AUTO_FIX_MAX_ATTEMPTS - 1
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({
      type: 'submit-prompt',
      finishedAt: 100,
      paneKey: 'tab:leaf-1'
    })
  })

  it('skips when any pane in the worktree is working', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      agentPanes: [donePane('tab:leaf-1', 10), { paneKey: 'tab:leaf-2', state: 'working', stateStartedAt: 5 }]
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('skips when any pane in the worktree is waiting', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      agentPanes: [donePane('tab:leaf-1', 10), { paneKey: 'tab:leaf-2', state: 'waiting', stateStartedAt: 5 }]
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('skips when there is no done pane at all', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      agentPanes: [{ paneKey: 'tab:leaf-1', state: 'blocked', stateStartedAt: 10 }]
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })

  it('resets attempts on a new passed result when attempts were made', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      result: { status: 'passed', exitCode: 0, error: null, finishedAt: 100 },
      attemptCount: 2
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'reset-attempts', finishedAt: 100 })
  })

  it('ignores a passed result when no attempts were made', () => {
    const input: WorkspaceCheckAutoFixDecisionInput = {
      ...baseInput,
      result: { status: 'passed', exitCode: 0, error: null, finishedAt: 100 },
      attemptCount: 0
    }
    expect(decideWorkspaceCheckAutoFix(input)).toEqual({ type: 'ignore' })
  })
})
