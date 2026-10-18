// The "Джарвис" voice companion's brain: one persistent Claude conversation, running
// headless (no UI tab, no journal) in the `~/assistant` folder so its CLAUDE.md,
// .claude/settings.json permissions, skills and memory apply exactly as they would
// to a person typing into the Claude CLI there.
//
// Built on the same stream-json connection the native-chat tabs use
// (`openClaudeStreamJsonConnection`) rather than the full `ClaudeStructuredSessionAdapter`:
// that adapter's job is translating a live child into UI journal rows, prompt-ownership
// and tab-restart bookkeeping this headless caller has none of. The low-level connection
// already owns everything a caller still needs — cross-platform process spawning, env
// construction, exit proof — so reusing it avoids a second, parallel Claude integration
// without dragging in machinery this module has no use for.

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  openClaudeStreamJsonConnection,
  type ClaudeStreamJsonConnection
} from '../claude/claude-stream-json-connection'
import {
  CLAUDE_STRUCTURED_BASE_OPTIONS,
  type ClaudeStructuredSdkOptions
} from '../claude/claude-structured-launch-resolution'
import { claudeChildEnv, resolveClaudeChildEnvSources } from '../claude/claude-structured-child-env'
import { resolveClaudeCommand } from '../codex-cli/command'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'
import type { CompanionBrainModel } from '../../shared/companion-types'

// Why a fallback constant rather than required: `getCompanionBrain` passes the user's
// configured `CompanionSettings.brainModel`, but older/malformed settings may be missing it.
const COMPANION_DEFAULT_MODEL: CompanionBrainModel = 'sonnet'

// Why appended rather than a whole custom prompt: keeps Claude Code's own
// system-prompt contract (tool docs, CLAUDE.md wiring) and only adds the one thing
// a headless voice reply needs that a terminal reply doesn't.
const COMPANION_SPOKEN_REPLY_ADDENDUM =
  'Твои ответы озвучиваются вслух на русском сразу после отправки, как в разговоре с ' +
  'голосовым ассистентом. Начинай с короткой фразы по существу, без долгих вступлений. ' +
  'Не используй markdown-таблицы и блоки кода в ответе: код, списки и прочее форматирование ' +
  'пересказывай обычными словами, подходящими для устной речи. Всегда пиши букву "ё" там, где ' +
  'она должна быть ("всё", "ещё", "зелёные"), а не "е" — иначе голос прочитает слово неправильно.'

export type CompanionBrainEvent =
  | { type: 'delta'; text: string }
  // Measured real turn: the ~15s gap users notice is almost entirely Claude thinking/
  // running tools before any text — fired once, on the turn's first tool call, so the
  // dialogue orchestrator can speak a cached "Секунду, смотрю…" instead of dead air.
  | { type: 'tool-start' }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }

export type CompanionBrainEventHandler = (event: CompanionBrainEvent) => void

/** `''`/unset resolves to `~/assistant`, matching the shell slice's `CompanionSettings.homeDir`. */
export function resolveCompanionHomeDir(homeDir: string | undefined): string {
  const trimmed = homeDir?.trim()
  return trimmed ? trimmed : join(homedir(), 'assistant')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ActiveCompanionTurn = {
  onEvent: CompanionBrainEventHandler
  settle: () => void
}

export type CompanionBrainDeps = {
  openConnection: typeof openClaudeStreamJsonConnection
  resolveCommand: () => string
}

const DEFAULT_COMPANION_BRAIN_DEPS: CompanionBrainDeps = {
  openConnection: openClaudeStreamJsonConnection,
  resolveCommand: resolveClaudeCommand
}

/**
 * One live Claude child, reused across `send()` calls as a single ongoing conversation
 * (streaming-input `query()` keeps its own context between turns — no `--resume` needed).
 * `reset()` drops the child; the next `send()` opens a fresh one, with no memory of the last.
 */
export class CompanionBrain {
  private readonly homeDir: string
  private readonly model: CompanionBrainModel
  private readonly deps: CompanionBrainDeps
  private connection: Promise<ClaudeStreamJsonConnection> | null = null
  private providerSessionId: string | null = null
  private activeTurn: ActiveCompanionTurn | null = null
  // Why: a reset closes the old child asynchronously; its late exit must not tear down the new one.
  private generation = 0
  // Why serialized: the connection's handlers are per-connection, not per-message, so two
  // in-flight turns would interleave their deltas into one onEvent stream unreadably.
  private queue: Promise<void> = Promise.resolve()

  constructor(homeDir: string, model: CompanionBrainModel, deps: Partial<CompanionBrainDeps> = {}) {
    this.homeDir = homeDir
    this.model = model
    this.deps = { ...DEFAULT_COMPANION_BRAIN_DEPS, ...deps }
  }

  /** The live Claude session id, for callers (the agent-watch notifier) that must recognize
   *  and exclude the companion's own headless turns from signals meant for other agents. */
  getProviderSessionId(): string | null {
    return this.providerSessionId
  }

  reset(): void {
    const pending = this.connection
    this.generation += 1
    this.connection = null
    this.providerSessionId = null
    this.endActiveTurn({ type: 'error', message: 'the companion conversation was reset' })
    if (pending) {
      void pending.then((connection) => connection.close()).catch(() => undefined)
    }
  }

  async send(text: string, onEvent: CompanionBrainEventHandler): Promise<void> {
    const next = this.queue.then(() => this.runTurn(text, onEvent))
    this.queue = next.catch(() => undefined)
    return next
  }

  private endActiveTurn(event: CompanionBrainEvent): void {
    const turn = this.activeTurn
    if (!turn) {
      return
    }
    this.activeTurn = null
    turn.onEvent(event)
    turn.settle()
  }

  private async ensureConnection(): Promise<ClaudeStreamJsonConnection> {
    if (!this.connection) {
      this.connection = this.openConnection().catch((error: unknown) => {
        this.connection = null
        throw error
      })
    }
    return this.connection
  }

  private async openConnection(): Promise<ClaudeStreamJsonConnection> {
    const generation = this.generation
    const providerSessionId = randomUUID()
    const command = this.deps.resolveCommand()
    const sources = await resolveClaudeChildEnvSources({ resolveCommand: this.deps.resolveCommand })
    // `stripAuthEnv: false` — the companion runs as the signed-in user's own Claude
    // login (system account), never a managed/rotated credential.
    const env = claudeChildEnv(sources, false)
    const options: ClaudeStructuredSdkOptions = {
      ...CLAUDE_STRUCTURED_BASE_OPTIONS,
      model: this.model,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: COMPANION_SPOKEN_REPLY_ADDENDUM
      },
      sessionId: providerSessionId
    }
    const isCurrent = (): boolean => generation === this.generation
    const connection = await this.deps.openConnection(
      { pathToClaudeCodeExecutable: command, options, cwd: this.homeDir, env },
      {
        onMessage: (message) => {
          if (isCurrent()) {
            this.handleMessage(message)
          }
        },
        onFault: (error) => {
          if (isCurrent()) {
            this.handleConnectionEnded(error)
          }
        },
        onExit: (error) => {
          if (isCurrent()) {
            this.handleConnectionEnded(error)
          }
        }
      }
    )
    if (isCurrent()) {
      this.providerSessionId = providerSessionId
    }
    return connection
  }

  private handleConnectionEnded(error: Error): void {
    this.connection = null
    this.providerSessionId = null
    this.endActiveTurn({ type: 'error', message: errorMessage(error) })
  }

  private handleMessage(frame: Record<string, unknown>): void {
    // Claude's stream-json frames carry `parent_tool_use_id` on every frame; a string names
    // the tool call (subagent/background task) that produced it, so only its absence is this
    // conversation's own root turn.
    if (!this.activeTurn || typeof frame.parent_tool_use_id === 'string') {
      return
    }
    if (frame.type === 'stream_event') {
      const event = frame.event
      if (
        isRecord(event) &&
        event.type === 'content_block_start' &&
        isRecord(event.content_block) &&
        event.content_block.type === 'tool_use'
      ) {
        this.activeTurn.onEvent({ type: 'tool-start' })
        return
      }
      const delta = isRecord(event) ? event.delta : null
      if (isRecord(delta) && delta.type === 'text_delta' && typeof delta.text === 'string') {
        this.activeTurn.onEvent({ type: 'delta', text: delta.text })
      }
      return
    }
    if (frame.type === 'result') {
      const text = typeof frame.result === 'string' ? frame.result : ''
      if (frame.is_error === true) {
        this.endActiveTurn({
          type: 'error',
          message:
            text || `the companion's turn ended in error (${String(frame.subtype ?? 'unknown')})`
        })
      } else {
        this.endActiveTurn({ type: 'final', text })
      }
    }
  }

  private async runTurn(text: string, onEvent: CompanionBrainEventHandler): Promise<void> {
    let connection: ClaudeStreamJsonConnection
    try {
      connection = await this.ensureConnection()
    } catch (error) {
      onEvent({ type: 'error', message: errorMessage(error) })
      return
    }
    const sessionId = this.providerSessionId ?? undefined
    await new Promise<void>((resolve) => {
      this.activeTurn = { onEvent, settle: resolve }
      const message = {
        type: 'user' as const,
        uuid: randomUUID(),
        message: { role: 'user' as const, content: [{ type: 'text' as const, text }] },
        parent_tool_use_id: null,
        session_id: sessionId
      }
      connection.send(message).catch((error: unknown) => {
        if (this.activeTurn?.settle === resolve) {
          this.activeTurn = null
          onEvent({ type: 'error', message: errorMessage(error) })
          resolve()
        }
      })
    })
  }
}

type CompanionHomeSettingsStore = {
  getSettings(): { companion?: { homeDir?: string; brainModel?: CompanionBrainModel } }
}

let companionBrain: CompanionBrain | null = null

/** Lazy singleton, à la `getSpeechSttService(store)`: the home dir and model are read once,
 *  from whatever settings store the caller holds — this module owns no settings type of its own. */
export function getCompanionBrain(store: CompanionHomeSettingsStore): CompanionBrain {
  if (!companionBrain) {
    const companion = store.getSettings().companion
    companionBrain = new CompanionBrain(
      resolveCompanionHomeDir(companion?.homeDir),
      companion?.brainModel ?? COMPANION_DEFAULT_MODEL
    )
  }
  return companionBrain
}

export function resetCompanionBrainForTests(): void {
  companionBrain = null
}
