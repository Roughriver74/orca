import { defineMethod } from '../core'
import { CompanionAsk, CompanionSay } from '../../../../shared/rpc-contract/companion-params'

// Why one-shot rather than `defineStreamingMethod`: the CLI's local request/response
// socket (`dispatcher.ts`) refuses streaming methods outright ("requires a streaming
// transport") — only the websocket/mobile path supports `emit`. The companion's deltas
// still stream in-process (see `CompanionBrain.send`); this boundary only ever has one
// caller reachable from here, and it gets the finished reply.
export const COMPANION_METHODS = [
  defineMethod({
    name: 'companion.ask',
    permission: 'workspace',
    params: CompanionAsk,
    handler: async (params, { runtime }) => runtime.companionAsk(params)
  }),
  defineMethod({
    name: 'companion.say',
    permission: 'workspace',
    params: CompanionSay,
    handler: async (params, { runtime }) => runtime.companionSay(params)
  })
]
