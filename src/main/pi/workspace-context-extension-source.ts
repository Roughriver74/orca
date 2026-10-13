export const ORCA_OMP_WORKSPACE_CONTEXT_EXTENSION_FILE = 'orca-workspace-context.ts'

// Why: written into ~/.omp/agent/extensions, so it loads for every OMP session; it stays inert
// outside Orca panes (no ORCA_PANE_KEY). It cannot import Orca code, so the `{variable}` expansion
// below is a deliberately small mirror of src/shared/prompt-snippet-variables.ts.
const SOURCE = String.raw`import { execFile } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const MAX_CHANGED_FILES = 40
const GIT_TIMEOUT_MS = 3000

function git(cwd, args) {
  const { promise, resolve } = Promise.withResolvers()
  execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    resolve(error ? null : String(stdout))
  })
  return promise
}

// Why: porcelain v1 + -b is stable since long before the Git 2.25 baseline.
async function readWorkspace(cwd) {
  const status = await git(cwd, ['status', '--porcelain=v1', '-b'])
  if (status === null) return null
  const lines = status.split('\n').filter(Boolean)
  const header = lines[0] && lines[0].startsWith('## ') ? lines.shift().slice(3) : ''
  const branch = header.split('...')[0].replace(/^No commits yet on /, '') || 'HEAD'
  return { branch, changed: lines }
}

function formatContext(workspace) {
  const shown = workspace.changed.slice(0, MAX_CHANGED_FILES)
  const more = workspace.changed.length - shown.length
  return [
    '<orca-workspace>',
    'branch: ' + workspace.branch,
    workspace.changed.length === 0
      ? 'working tree: clean'
      : 'changed files (' + workspace.changed.length + '):\n' + shown.join('\n') + (more > 0 ? '\n... ' + more + ' more' : ''),
    '</orca-workspace>'
  ].join('\n')
}

function parsePromptFile(fileName, text) {
  let body = text
  let name = basename(fileName, '.md')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (match) {
    body = text.slice(match[0].length)
    const nameLine = /^name:\s*(.+)$/m.exec(match[1])
    if (nameLine) name = nameLine[1].trim()
  }
  return { name, body: body.trim() }
}

function loadRepoPrompts(cwd) {
  const dir = join(cwd, '.orca', 'prompts')
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const prompts = []
  for (const fileName of entries.sort()) {
    if (!fileName.endsWith('.md')) continue
    const command = basename(fileName, '.md').toLowerCase().replace(/[^a-z0-9-]+/g, '-')
    if (!command) continue
    try {
      const prompt = parsePromptFile(fileName, readFileSync(join(dir, fileName), 'utf8'))
      if (prompt.body) prompts.push({ command, ...prompt })
    } catch {}
  }
  return prompts
}

async function expandPrompt(body, cwd) {
  const workspace = await readWorkspace(cwd)
  const values = {
    branch: workspace ? workspace.branch : '',
    worktree: cwd,
    repo: basename(cwd),
    changedFiles: workspace ? workspace.changed.map((line) => line.slice(3)).join('\n') : ''
  }
  // Why: variables only Orca can resolve (file, selection, check output...) expand to empty,
  // matching Orca's own handling of an unavailable variable.
  const known = ['branch', 'worktree', 'repo', 'file', 'selection', 'issue', 'clipboard',
    'changedFiles', 'checkCommand', 'checkOutput', 'lastAgentMessage', 'overlap']
  return body.replace(/\{([a-zA-Z]+)\}/g, (token, name) =>
    known.includes(name) ? (values[name] || '') : token
  )
}

export default function (pi) {
  if (!process.env.ORCA_PANE_KEY) return
  const startCwd = process.cwd()

  for (const prompt of loadRepoPrompts(startCwd)) {
    pi.registerCommand(prompt.command, {
      description: 'Orca repo prompt: ' + prompt.name,
      handler: async (args, ctx) => {
        const cwd = (ctx && ctx.cwd) || startCwd
        const text = await expandPrompt(prompt.body, cwd)
        const extra = String(args || '').trim()
        pi.sendUserMessage(extra ? text + '\n\n' + extra : text)
      }
    })
  }

  // Why: inject only when the workspace changed since the last accepted prompt, so steady
  // conversations do not pay for the same block every turn. The candidate is committed on
  // agent_start because before_agent_start may be re-run or discarded.
  let committedContext = ''
  let candidateContext = ''
  pi.on('before_agent_start', async (_event, ctx) => {
    const workspace = await readWorkspace((ctx && ctx.cwd) || startCwd)
    if (!workspace) return
    const context = formatContext(workspace)
    candidateContext = context
    if (context === committedContext) return
    // Why: without user attribution OMP places the block where the model reads it as its own output.
    return {
      message: {
        customType: 'orca-workspace-context',
        content: context,
        display: false,
        attribution: 'user'
      }
    }
  })
  pi.on('agent_start', async () => {
    committedContext = candidateContext
  })
}
`

export function getOmpWorkspaceContextExtensionSource(): string {
  return SOURCE
}
