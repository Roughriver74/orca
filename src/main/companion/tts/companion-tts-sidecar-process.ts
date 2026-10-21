// Owns the one companion TTS sidecar child process: starts it on first use, restarts
// it with backoff if it crashes, and routes synthesis requests/responses by id so
// multiple sentences can be in flight (the brain streams sentence N+1's text while
// N is still synthesizing/playing).

import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawnProcess } from '@orca/process-host'
import { forceTerminateProcessTree } from '@orca/process-host/process-tree-termination'
import {
  createCompanionTtsSidecarFrameReader,
  type CompanionTtsSidecarFrame
} from './companion-tts-sidecar-protocol'

export type CompanionTtsSynthesisChunk = {
  requestId: string
  seq: number
  sampleRate: number
  final: boolean
  pcm: Float32Array
}

export type CompanionTtsSidecarConfig = {
  pythonPath: string
  scriptPath: string
  /** Absolute path to v5_4_ru.pt, or null if the v5 voice family was not provisioned. */
  v5ModelPath: string | null
  /** Absolute path to v3_1_ru.pt, or null if the v3 voice family (eugene) was not provisioned. */
  v3ModelPath: string | null
}

export class CompanionTtsCancelledError extends Error {
  constructor(requestId: string) {
    super(`companion TTS request ${requestId} was cancelled`)
    this.name = 'CompanionTtsCancelledError'
  }
}

const READY_TIMEOUT_MS = 30_000
const SHUTDOWN_GRACE_MS = 5_000
const RESTART_BACKOFF_BASE_MS = 500
const RESTART_BACKOFF_MAX_MS = 15_000
const STDERR_TAIL_CHARS = 4000

type PendingRequest = {
  onChunk: (chunk: CompanionTtsSynthesisChunk) => void
  resolve: () => void
  reject: (error: Error) => void
}

type SpawnFn = (spec: {
  program: string
  args: readonly string[]
}) => ChildProcessWithoutNullStreams

export class CompanionTtsSidecarProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private readyPromise: Promise<void> | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private stopping = false
  private crashCount = 0
  private stderrTail = ''

  constructor(
    private readonly config: CompanionTtsSidecarConfig,
    private readonly spawn: SpawnFn = spawnProcess
  ) {}

  /** True once a sidecar child is running and has sent its `ready` frame. */
  isHealthy(): boolean {
    return this.child !== null && !this.stopping
  }

  /** Spawns the child and waits for its `ready` frame (model load included) without
   *  synthesizing anything — used to prewarm the sidecar ahead of the first reply so the
   *  ~1.4-2s cold start doesn't sit in that reply's critical path. Idempotent: a sidecar
   *  that is already starting or running just resolves the existing `ensureStarted()`. */
  async warmUp(): Promise<void> {
    await this.ensureStarted()
  }

  private async ensureStarted(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise
    }
    if (this.crashCount > 0) {
      const delay = Math.min(
        RESTART_BACKOFF_BASE_MS * 2 ** (this.crashCount - 1),
        RESTART_BACKOFF_MAX_MS
      )
      const { promise, resolve } = Promise.withResolvers<void>()
      setTimeout(resolve, delay)
      await promise
    }
    return this.spawnChild()
  }

  private spawnChild(): Promise<void> {
    const { pythonPath, scriptPath, v5ModelPath, v3ModelPath } = this.config
    const child = this.spawn({
      program: pythonPath,
      args: [scriptPath, v5ModelPath ?? '-', v3ModelPath ?? '-']
    })
    this.child = child
    this.stderrTail = ''
    this.stopping = false

    const {
      promise: readyPromise,
      resolve: settleReady,
      reject: rejectReady
    } = Promise.withResolvers<void>()
    this.readyPromise = readyPromise

    const readyTimeout = setTimeout(() => {
      rejectReady(new Error('companion TTS sidecar did not become ready in time'))
    }, READY_TIMEOUT_MS)
    readyTimeout.unref?.()

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (text: string) => {
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS)
    })
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      stream.on('error', () => {})
    }

    child.stdout.on(
      'data',
      createCompanionTtsSidecarFrameReader((frame) => {
        this.handleFrame(frame, settleReady, readyTimeout)
      })
    )

    child.once('error', (error: Error) => {
      clearTimeout(readyTimeout)
      rejectReady(error)
    })
    child.once('close', (code: number | null) => {
      clearTimeout(readyTimeout)
      const wasStopping = this.stopping
      this.child = null
      this.readyPromise = null
      const error = new Error(
        this.stderrTail.trim() || `companion TTS sidecar exited with code ${String(code)}`
      )
      rejectReady(error)
      for (const request of this.pending.values()) {
        request.reject(error)
      }
      this.pending.clear()
      if (!wasStopping) {
        this.crashCount += 1
      }
    })

    return readyPromise
  }

  private handleFrame(
    frame: CompanionTtsSidecarFrame,
    settleReady: () => void,
    readyTimeout: NodeJS.Timeout
  ): void {
    if (frame.type === 'ready') {
      clearTimeout(readyTimeout)
      this.crashCount = 0
      settleReady()
      return
    }
    if (frame.type === 'audio') {
      this.pending.get(frame.id)?.onChunk({
        requestId: frame.id,
        seq: frame.seq,
        sampleRate: frame.sampleRate,
        final: frame.final,
        pcm: frame.pcm
      })
      return
    }
    if (frame.type === 'done') {
      this.pending.get(frame.id)?.resolve()
      this.pending.delete(frame.id)
      return
    }
    if (frame.type === 'error' && frame.id) {
      this.pending.get(frame.id)?.reject(new Error(frame.message))
      this.pending.delete(frame.id)
    }
  }

  /** Synthesizes one utterance; `onChunk` fires for each PCM frame the sidecar streams back. */
  async synthesize(
    requestId: string,
    text: string,
    speaker: string,
    rate: number,
    onChunk: (chunk: CompanionTtsSynthesisChunk) => void
  ): Promise<void> {
    await this.ensureStarted()
    const child = this.child
    if (!child) {
      throw new Error('companion TTS sidecar is not running')
    }
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    this.pending.set(requestId, { onChunk, resolve, reject })
    child.stdin.write(`${JSON.stringify({ id: requestId, text, speaker, rate })}\n`)
    return promise
  }

  /** Drops a request: queued-but-unstarted requests never synthesize; an in-flight one's
   *  eventual response is discarded since its pending entry is already gone. */
  cancel(requestId: string): void {
    const request = this.pending.get(requestId)
    if (!request) {
      return
    }
    this.pending.delete(requestId)
    request.reject(new CompanionTtsCancelledError(requestId))
    this.child?.stdin.write(`${JSON.stringify({ type: 'cancel', id: requestId })}\n`)
  }

  async shutdown(): Promise<void> {
    this.stopping = true
    const child = this.child
    if (!child) {
      return
    }
    child.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`)
    child.stdin.end()
    const { promise, resolve } = Promise.withResolvers<void>()
    const timer = setTimeout(() => {
      void forceTerminateProcessTree(child)
      resolve()
    }, SHUTDOWN_GRACE_MS)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
    await promise
  }
}
