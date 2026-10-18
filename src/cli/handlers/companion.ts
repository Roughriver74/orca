import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getRequiredStringFlag } from '../flags'

export const COMPANION_HANDLERS: Record<string, CommandHandler> = {
  'companion ask': async ({ client, flags, json }) => {
    const text = getRequiredStringFlag(flags, 'text')
    const reset = flags.get('reset') === true
    const response = await client.call<{ text: string }>('companion.ask', { text, reset })
    printResult(response, json, (result) => result.text)
  },
  'companion say': async ({ client, flags, json }) => {
    const text = getRequiredStringFlag(flags, 'text')
    const response = await client.call<{ utteranceId: string }>('companion.say', { text })
    printResult(response, json, (result) => `Spoken (utterance ${result.utteranceId}).`)
  }
}
