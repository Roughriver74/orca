import { describe, expect, it } from 'vitest'
import { AsyncItemChannel } from './companion-tts-item-channel'

describe('AsyncItemChannel', () => {
  it('returns pushed items in order (boxed), then null once finished and drained', async () => {
    const channel = new AsyncItemChannel<number>()
    channel.push(1)
    channel.push(2)
    channel.finish()
    expect((await channel.next())?.value).toBe(1)
    expect((await channel.next())?.value).toBe(2)
    expect(await channel.next()).toBeNull()
    expect(await channel.next()).toBeNull()
  })

  it('a waiting consumer resolves as soon as a late push arrives', async () => {
    const channel = new AsyncItemChannel<string>()
    const pending = channel.next()
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    channel.push('late')
    expect((await pending)?.value).toBe('late')
  })

  it('a waiting consumer resolves to null once finish() arrives with nothing queued', async () => {
    const channel = new AsyncItemChannel<string>()
    const pending = channel.next()
    channel.finish()
    expect(await pending).toBeNull()
  })

  it('hands back a still-pending promise item without adopting its state (the bug this box exists to avoid)', async () => {
    const channel = new AsyncItemChannel<Promise<string>>()
    const { promise: itemPromise, resolve } = Promise.withResolvers<string>()
    channel.push(itemPromise)
    channel.finish()

    // Awaiting next() must resolve immediately with the box even though the promise it
    // wraps is still pending — proving next() did not auto-adopt/flatten it.
    const boxed = await channel.next()
    expect(boxed).not.toBeNull()
    expect(boxed?.value).toBe(itemPromise)

    resolve('resolved later')
    expect(await boxed!.value).toBe('resolved later')
  })
})
