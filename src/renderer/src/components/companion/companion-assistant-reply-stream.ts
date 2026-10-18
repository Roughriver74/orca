import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { translate } from '@/i18n/i18n'
import type { CompanionTurn } from './CompanionPanel'

/** Subscribes to main's dialogue orchestrator (`companion:assistant*`) and keeps the
 *  streaming assistant bubble's text in sync — split out of `CompanionPanel` to keep
 *  that file under the repo's per-file line cap. */
export function useCompanionAssistantReplyStream(deps: {
  ensureAssistantTurn: () => number
  setTurns: Dispatch<SetStateAction<CompanionTurn[]>>
  currentAssistantTurnIdRef: MutableRefObject<number | null>
}): void {
  const { ensureAssistantTurn, setTurns, currentAssistantTurnIdRef } = deps
  useEffect(() => {
    const offDelta = window.api.companion.onAssistantDelta((text) => {
      const id = ensureAssistantTurn()
      setTurns((prev) =>
        prev.map((turn) => (turn.id === id ? { ...turn, text: turn.text + text } : turn))
      )
    })
    const offFinal = window.api.companion.onAssistantFinal((text) => {
      const id = ensureAssistantTurn()
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, text } : turn)))
      currentAssistantTurnIdRef.current = null
    })
    const offAssistantError = window.api.companion.onAssistantError((message) => {
      const id = ensureAssistantTurn()
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                text: translate(
                  'companion.panel.brainError',
                  'Не получилось ответить: {{message}}',
                  { message }
                ),
                isError: true
              }
            : turn
        )
      )
      currentAssistantTurnIdRef.current = null
    })
    return () => {
      offDelta()
      offFinal()
      offAssistantError()
    }
  }, [ensureAssistantTurn, setTurns, currentAssistantTurnIdRef])
}
