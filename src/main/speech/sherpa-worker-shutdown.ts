import type { Worker } from 'node:worker_threads'

const TEARDOWN_TIMEOUT_MS = 5000

/**
 * Stops a worker that calls the sherpa-onnx native addon by asking it to exit between
 * messages, never with `worker.terminate()`: terminating while the worker is inside a
 * sherpa call makes the addon throw a C++ Napi::Error into an isolate that is being torn
 * down, which aborts the whole app (SIGABRT, reproduced 2026-10-25 by terminating the VAD
 * worker mid-feed). A worker still stuck in native code after the timeout is unref'd and
 * left to finish — terminating it would hit the same abort.
 */
export async function stopSherpaWorker(
  worker: Worker,
  exited: Promise<void>,
  teardown: unknown
): Promise<void> {
  worker.postMessage(teardown)
  const timeout = Promise.withResolvers<'timeout'>()
  const timer = setTimeout(() => timeout.resolve('timeout'), TEARDOWN_TIMEOUT_MS)
  const outcome = await Promise.race([exited.then(() => 'exited' as const), timeout.promise])
  clearTimeout(timer)
  if (outcome === 'timeout') {
    console.warn('[speech] sherpa worker did not exit after teardown; leaving it unreferenced')
    worker.unref()
  }
}

/** Resolves once the worker thread has exited, however it ended. */
export function workerExited(worker: Worker): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  worker.once('exit', () => resolve())
  return promise
}
