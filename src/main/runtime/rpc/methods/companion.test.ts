import '../unused-default-rpc-methods.test-fixture'
import { describe, expect, it, vi } from 'vitest'
import { RpcDispatcher } from '../dispatcher'
import type { RpcRequest } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { COMPANION_METHODS } from './companion'

function makeRequest(method: string, params?: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method, params }
}

function fakeRuntime(companionAsk: OrcaRuntimeService['companionAsk']): OrcaRuntimeService {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: these tests only dispatch `companion.ask`, which the dispatcher routes to `runtime.companionAsk`/`getRuntimeId`.
  return { getRuntimeId: () => 'test-runtime', companionAsk } as unknown as OrcaRuntimeService
}

describe('companion RPC methods', () => {
  it('forwards text and reset to runtime.companionAsk and returns its result', async () => {
    const runtime = fakeRuntime(vi.fn().mockResolvedValue({ text: 'Привет!' }))
    const dispatcher = new RpcDispatcher({ runtime, methods: COMPANION_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest('companion.ask', { text: 'Привет', reset: true })
    )

    expect(runtime.companionAsk).toHaveBeenCalledWith({ text: 'Привет', reset: true })
    expect(response).toMatchObject({ ok: true, result: { text: 'Привет!' } })
  })

  it('rejects a request missing text', async () => {
    const runtime = fakeRuntime(vi.fn())
    const dispatcher = new RpcDispatcher({ runtime, methods: COMPANION_METHODS })

    const response = await dispatcher.dispatch(makeRequest('companion.ask', {}))

    expect(response).toMatchObject({ ok: false })
    expect(runtime.companionAsk).not.toHaveBeenCalled()
  })

  it('surfaces a rejected companionAsk as an RPC failure', async () => {
    const runtime = fakeRuntime(vi.fn().mockRejectedValue(new Error('claude turn failed')))
    const dispatcher = new RpcDispatcher({ runtime, methods: COMPANION_METHODS })

    const response = await dispatcher.dispatch(makeRequest('companion.ask', { text: 'hi' }))

    expect(response).toMatchObject({ ok: false })
  })
})
