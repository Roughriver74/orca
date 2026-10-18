import { z } from 'zod'
import { OptionalBoolean, requiredString } from './rpc-param-primitives'

export const CompanionAsk = z.object({
  text: requiredString('Missing text'),
  reset: OptionalBoolean
})

export const CompanionSay = z.object({
  text: requiredString('Missing text')
})

export const CompanionStatus = z.object({})

export const CompanionToggle = z.object({})
