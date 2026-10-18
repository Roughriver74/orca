import { EventEmitter } from 'node:events'
import {
  isCompanionStopPhrase,
  type CompanionConversationState
} from '../../shared/companion-types'

export type { CompanionConversationState } from '../../shared/companion-types'

/** Point-in-time view of the conversation for `companion.status`: current state plus the
 *  last user/assistant turn and when any of it last changed. */
export type CompanionConversationSnapshot = {
  state: CompanionConversationState
  lastUserText: string | null
  lastAssistantText: string | null
  updatedAt: number
}

/**
 * Brain-agnostic conversation state machine for the companion panel. The shell
 * drives `start`/`stop`/`reportUtterance` from hotkey + renderer IPC; the dialogue
 * orchestrator subscribes via `onUtterance`/`onStateChange` to generate replies
 * and call `reportThinking`/`reportSpeaking`/`reportListening` around each turn.
 */
class CompanionConversation extends EventEmitter {
  private state: CompanionConversationState = 'idle'
  private lastUserText: string | null = null
  private lastAssistantText: string | null = null
  private updatedAt: number = Date.now()

  getState(): CompanionConversationState {
    return this.state
  }

  /** Snapshot for `companion.status`: taken fresh on every call, not cached. */
  getSnapshot(): CompanionConversationSnapshot {
    return {
      state: this.state,
      lastUserText: this.lastUserText,
      lastAssistantText: this.lastAssistantText,
      updatedAt: this.updatedAt
    }
  }

  private setState(next: CompanionConversationState): void {
    if (this.state === next) {
      return
    }
    this.state = next
    this.updatedAt = Date.now()
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
    this.lastUserText = text
    this.updatedAt = Date.now()
    this.emit('utterance', text)
    return { stopped: false }
  }

  /** The brain's finished reply text for the current turn, for `companion.status`. */
  reportAssistantFinal(text: string): void {
    this.lastAssistantText = text
    this.updatedAt = Date.now()
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
