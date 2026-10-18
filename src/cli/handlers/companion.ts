import type { CommandHandler } from '../dispatch'
import { printResult } from '../format'
import { getRequiredStringFlag } from '../flags'
import type {
  CompanionConversationState,
  CompanionTtsProvisioningStatus
} from '../../shared/companion-types'

// Why local rather than imported from `runtime-companion-controller`: that module is
// Electron-main-only (it reaches `companion-shortcut`, which imports `electron`); the CLI's
// own tsconfig project deliberately excludes it, matching the inline result types `ask`/`say`
// already use below.
type CompanionStatusResult = {
  enabled: boolean
  state: CompanionConversationState
  hotkey: string
  lastUserText: string | null
  lastAssistantText: string | null
  updatedAt: number
  tts: CompanionTtsProvisioningStatus
}
type CompanionToggleResult = { state: CompanionConversationState }

const COMPANION_STATE_RU: Record<CompanionConversationState, string> = {
  idle: 'ожидает',
  listening: 'слушает',
  thinking: 'думает',
  speaking: 'говорит'
}

function formatCompanionStatus(result: CompanionStatusResult): string {
  if (!result.enabled) {
    return 'Джарвис: выключен'
  }
  return `Джарвис: ${COMPANION_STATE_RU[result.state]} (горячая клавиша ${result.hotkey}, озвучка: ${result.tts.status})`
}

function formatCompanionToggle(result: CompanionToggleResult): string {
  return `Джарвис: ${COMPANION_STATE_RU[result.state]}`
}

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
  },
  'companion status': async ({ client, json }) => {
    const response = await client.call<CompanionStatusResult>('companion.status', {})
    printResult(response, json, formatCompanionStatus)
  },
  'companion toggle': async ({ client, json }) => {
    const response = await client.call<CompanionToggleResult>('companion.toggle', {})
    printResult(response, json, formatCompanionToggle)
  }
}
