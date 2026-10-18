import { describe, expect, it, vi } from 'vitest'
import {
  companionConversation,
  onCompanionStateChange,
  onCompanionUtterance
} from './companion-conversation'

describe('companionConversation', () => {
  it('starts listening and emits utterances that are not stop phrases', () => {
    const utterances: string[] = []
    const off = onCompanionUtterance((text) => utterances.push(text))
    companionConversation.start()
    expect(companionConversation.getState()).toBe('listening')

    const result = companionConversation.reportUtterance('напиши заметку про проект')
    expect(result).toEqual({ stopped: false })
    expect(utterances).toEqual(['напиши заметку про проект'])
    expect(companionConversation.getState()).toBe('listening')
    off()
    companionConversation.stop()
  })

  it.each(['стоп', 'Стоп.', 'СТОП!!', '  отбой  ', 'Отбой,'])(
    'treats %j as an exact stop phrase and ends the conversation',
    (phrase) => {
      const utterances = vi.fn()
      const off = onCompanionUtterance(utterances)
      companionConversation.start()

      const result = companionConversation.reportUtterance(phrase)

      expect(result).toEqual({ stopped: true })
      expect(companionConversation.getState()).toBe('idle')
      expect(utterances).not.toHaveBeenCalled()
      off()
    }
  )

  it('does not treat a stop phrase appearing inside a longer utterance as a stop', () => {
    companionConversation.start()
    const result = companionConversation.reportUtterance('стоп машина не моя')
    expect(result).toEqual({ stopped: false })
    expect(companionConversation.getState()).toBe('listening')
    companionConversation.stop()
  })

  it('notifies state subscribers on start/thinking/speaking/listening/stop transitions', () => {
    const states: string[] = []
    const off = onCompanionStateChange((state) => states.push(state))
    companionConversation.start()
    companionConversation.reportThinking()
    companionConversation.reportSpeaking()
    companionConversation.reportListening()
    companionConversation.stop()
    expect(states).toEqual(['listening', 'thinking', 'speaking', 'listening', 'idle'])
    off()
  })

  it('reportSpeaking is a no-op once the conversation is idle', () => {
    companionConversation.stop()
    companionConversation.reportSpeaking()
    expect(companionConversation.getState()).toBe('idle')
  })
})
