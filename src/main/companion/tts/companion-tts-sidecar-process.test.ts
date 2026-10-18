import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CompanionTtsCancelledError,
  CompanionTtsSidecarProcess,
  type CompanionTtsSynthesisChunk
} from './companion-tts-sidecar-process'

function fakeChild(): ChildProcessWithoutNullStreams & { writes: string[] } {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: EventEmitter only needs the stdin/stdout/stderr/writes members this fixture assigns below.
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & {
    writes: string[]
  }
  child.writes = []
  const writes = child.writes
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture only implements write()/end(), the subset CompanionTtsSidecarProcess calls on stdin.
  child.stdin = Object.assign(new EventEmitter(), {
    write: vi.fn((data: string) => {
      writes.push(data)
      return true
    }),
    end: vi.fn()
  }) as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture emits 'data' events only, the subset CompanionTtsSidecarProcess reads from stdout.
  child.stdout = new EventEmitter() as never
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture only implements setEncoding(), the subset CompanionTtsSidecarProcess calls on stderr.
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() }) as never
  return child
}

function headerLine(header: Record<string, unknown>): Buffer {
  return Buffer.from(`${JSON.stringify(header)}\n`, 'utf8')
}

function emitReady(child: ChildProcessWithoutNullStreams): void {
  child.stdout.emit('data', headerLine({ type: 'ready' }))
}

function emitAudioAndDone(
  child: ChildProcessWithoutNullStreams,
  id: string,
  samples: number[]
): void {
  const pcm = Buffer.from(new Float32Array(samples).buffer)
  child.stdout.emit(
    'data',
    Buffer.concat([
      headerLine({ type: 'audio', id, seq: 0, sampleRate: 48000, final: true, bytes: pcm.length }),
      pcm,
      headerLine({ type: 'done', id })
    ])
  )
}

/** Drains the `ensureStarted`/`synthesize` await chain deterministically: a synchronously
 *  emitted 'ready' frame still needs several microtask hops to resolve through them. */
async function flushAsync(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

describe('CompanionTtsSidecarProcess', () => {
  const config = {
    pythonPath: '/fake/python',
    scriptPath: '/fake/sidecar.py',
    v5ModelPath: '/fake/v5.pt',
    v3ModelPath: '/fake/v3.pt'
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lazily starts the child only on the first synthesize call', async () => {
    const child = fakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)
    expect(spawn).not.toHaveBeenCalled()

    const chunks: CompanionTtsSynthesisChunk[] = []
    const done = sidecar.synthesize('r1', 'привет', 'eugene', 1, (c) => chunks.push(c))
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith({
      program: '/fake/python',
      args: ['/fake/sidecar.py', '/fake/v5.pt', '/fake/v3.pt']
    })

    emitReady(child)
    await flushAsync()
    emitAudioAndDone(child, 'r1', [0.5, -0.5])
    await done

    expect(chunks).toHaveLength(1)
    expect(Array.from(chunks[0].pcm)).toEqual([0.5, -0.5])
    expect(child.writes[0]).toContain('"id":"r1"')
  })

  it('reuses the running child for a second request instead of respawning', async () => {
    const child = fakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)

    const first = sidecar.synthesize('r1', 'a', 'eugene', 1, () => {})
    emitReady(child)
    await flushAsync()
    emitAudioAndDone(child, 'r1', [1])
    await first

    const second = sidecar.synthesize('r2', 'b', 'eugene', 1, () => {})
    await flushAsync()
    emitAudioAndDone(child, 'r2', [2])
    await second

    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('rejects in-flight requests and restarts with backoff after a crash', async () => {
    const firstChild = fakeChild()
    const secondChild = fakeChild()
    const spawn = vi.fn().mockReturnValueOnce(firstChild).mockReturnValueOnce(secondChild)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)

    const failing = sidecar.synthesize('r1', 'a', 'eugene', 1, () => {})
    emitReady(firstChild)
    await flushAsync()
    firstChild.emit('close', 1)
    await expect(failing).rejects.toThrow()

    // Backoff delay before the restart spawns a fresh child.
    const nextRequest = sidecar.synthesize('r2', 'b', 'eugene', 1, () => {})
    expect(spawn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawn).toHaveBeenCalledTimes(2)
    emitReady(secondChild)
    await flushAsync()
    emitAudioAndDone(secondChild, 'r2', [3])
    await nextRequest
  })

  it('cancel rejects the pending promise with CompanionTtsCancelledError and tells the sidecar', async () => {
    const child = fakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)

    const pending = sidecar.synthesize('r1', 'привет', 'eugene', 1, () => {})
    emitReady(child)
    await flushAsync()
    sidecar.cancel('r1')

    await expect(pending).rejects.toBeInstanceOf(CompanionTtsCancelledError)
    expect(child.writes.some((w) => w.includes('"type":"cancel"') && w.includes('"id":"r1"'))).toBe(
      true
    )

    // A late audio/done frame for the cancelled id must not throw or resurface.
    emitAudioAndDone(child, 'r1', [9])
  })

  it('cancel on an unknown id is a no-op', () => {
    const child = fakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)
    expect(() => sidecar.cancel('missing')).not.toThrow()
  })

  it('shutdown sends the shutdown message and resolves on close', async () => {
    const child = fakeChild()
    const spawn = vi.fn().mockReturnValue(child)
    const sidecar = new CompanionTtsSidecarProcess(config, spawn)

    const started = sidecar.synthesize('r1', 'a', 'eugene', 1, () => {})
    emitReady(child)
    await flushAsync()
    emitAudioAndDone(child, 'r1', [1])
    await started

    const shutdown = sidecar.shutdown()
    expect(child.writes.some((w) => w.includes('"type":"shutdown"'))).toBe(true)
    expect(child.stdin.end).toHaveBeenCalled()
    child.emit('close', 0)
    await shutdown
    expect(sidecar.isHealthy()).toBe(false)
  })
})
