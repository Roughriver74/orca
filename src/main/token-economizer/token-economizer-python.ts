import { runProcess } from '@orca/process-host'

const PYTHON_PROBE_TIMEOUT_MS = 10_000
const PYTHON_VERSION_CHECK = 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'

async function isPython310(command: readonly string[]): Promise<boolean> {
  try {
    const result = await runProcess({
      program: command[0],
      args: [...command.slice(1), '-c', PYTHON_VERSION_CHECK],
      timeoutMs: PYTHON_PROBE_TIMEOUT_MS
    })
    return result.code === 0
  } catch {
    return false
  }
}

/** TokenEconomizer's hooks need Python 3.10+; TE_PYTHON overrides the interpreter like it does for TE. */
export async function findTokenEconomizerPython(): Promise<readonly string[] | null> {
  // Windows: TE's Codex hook and Pi extension start bare `python`, so `py -3` alone would leave them dead.
  const candidates = process.env.TE_PYTHON
    ? [[process.env.TE_PYTHON]]
    : process.platform === 'win32'
      ? [['python']]
      : [['python3'], ['python']]
  for (const command of candidates) {
    if (await isPython310(command)) {
      return command
    }
  }
  return null
}
