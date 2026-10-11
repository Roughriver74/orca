// ─── Workspace check (per-repo verification run when an agent finishes) ────
// A repo-scoped "Check command" runs automatically in a workspace's execution host
// (local or SSH) once every agent pane in that workspace leaves the `working` state.

export type WorkspaceCheckRunStatus = 'running' | 'passed' | 'failed'

export type WorkspaceCheckState = {
  worktreeId: string
  command: string
  status: WorkspaceCheckRunStatus
  /** Exit code of the finished run; null while running, on timeout, or when the process never started. */
  exitCode: number | null
  /** Why the run could not complete cleanly (e.g. "SSH target is not connected."); null otherwise. */
  error: string | null
  timedOut: boolean
  startedAt: number
  /** Null while `status` is `running`. */
  finishedAt: number | null
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

/** Quiet window after an agent leaves `working` before the check runs, so a flurry of
 *  rapid status flaps (e.g. a quick permission prompt) does not start a run that an
 *  immediately-resumed agent would just cancel. */
export const WORKSPACE_CHECK_DEBOUNCE_MS = 4_000
export const WORKSPACE_CHECK_TIMEOUT_SECONDS = 600
export const WORKSPACE_CHECK_MAX_OUTPUT_CHARS = 20_000
