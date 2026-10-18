// A minimal async FIFO channel: a producer `push`es items (and eventually `finish`es),
// a consumer awaits `next()` one at a time. Used to decouple "a sentence became
// available" from "its synthesis result is ready" (see companion-tts-service.ts) so a
// slow producer (the brain still writing) never blocks sending an already-synthesized
// chunk, while an eager producer still gets its sentences synthesized in order as soon
// as each one completes.
//
// `next()` resolves with a box (`{ value: T }`), not `T` directly: this channel's whole
// use case is `T = Promise<...>`, and the JS spec auto-adopts a thenable's state at
// *any* point one is handed to a promise as its resolution value — returning it from
// an async function, resolving with it, or returning it from a `.then()` callback all
// trigger the same flattening. `await next()` would then block until the inner promise
// *settles* instead of handing back the promise object, collapsing the two-level
// "queued vs. synthesized" decoupling this class exists for. A box is never itself a
// thenable, so it survives every one of those hand-offs intact; only the caller's own
// plain `.value` property read (not a promise mechanism) exposes the inner thenable.

export type BoxedChannelItem<T> = { value: T }

export class AsyncItemChannel<T> {
  private readonly queue: BoxedChannelItem<T>[] = []
  private finished = false
  private waiters: (() => void)[] = []

  push(item: T): void {
    this.queue.push({ value: item })
    this.wake()
  }

  finish(): void {
    this.finished = true
    this.wake()
  }

  private wake(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }

  /** Resolves with a box around the next queued item, or `null` once finished and drained. */
  async next(): Promise<BoxedChannelItem<T> | null> {
    for (;;) {
      const boxed = this.queue.shift()
      if (boxed) {
        return boxed
      }
      if (this.finished) {
        return null
      }
      const { promise, resolve } = Promise.withResolvers<void>()
      this.waiters.push(resolve)
      await promise
    }
  }
}
