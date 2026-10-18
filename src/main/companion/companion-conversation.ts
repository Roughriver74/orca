import { EventEmitter } from 'node:events'
import {
  isCompanionStopPhrase,
  type CompanionConversationState
} from '../../shared/companion-types'

export type { CompanionConversationState } from '../../shared/companion-types'

/**
 * Brain-agnostic conversation state machine for the companion panel. The shell
 * drives `start`/`stop`/`reportUtterance` from hotkey + renderer IPC; the dialogue
 * orchestrator subscribes via `onUtterance`/`onStateChange` to generate replies
 * and call `reportThinking`/`reportSpeaking`/`reportListening` around each turn.
 */
class CompanionConversation extends EventEmitter {
  private state: CompanionConversationState = 'idle'

  getState(): CompanionConversationState {
    return this.state
  }

  private setState(next: CompanionConversationState): void {
    if (this.state === next) {
      return
    }
    this.state = next
    this.emit('state', next)
  }

  start(): void {
    this.setState('listening')
  }

  stop(): void {
    this.setState('idle')
  }

  reportThinking(): void {
    if (this.state !== 'idle') {
      this.setState('thinking')
    }
  }

  reportListening(): void {
    if (this.state !== 'idle') {
      this.setState('listening')
    }
  }

  reportSpeaking(): void {
    if (this.state !== 'idle') {
      this.setState('speaking')
    }
  }

  /**
   * A finalized STT utterance from the panel. Stop phrases end the conversation
   * without reaching Brain subscribers; everything else is emitted as-is.
   * Returns whether this utterance ended the conversation.
   */
  reportUtterance(text: string): { stopped: boolean } {
    if (isCompanionStopPhrase(text)) {
      this.stop()
      return { stopped: true }
    }
    this.emit('utterance', text)
    return { stopped: false }
  }
}

export const companionConversation = new CompanionConversation()

export function onCompanionUtterance(listener: (text: string) => void): () => void {
  companionConversation.on('utterance', listener)
  return () => companionConversation.off('utterance', listener)
}

export function onCompanionStateChange(
  listener: (state: CompanionConversationState) => void
): () => void {
  companionConversation.on('state', listener)
  return () => companionConversation.off('state', listener)
}
