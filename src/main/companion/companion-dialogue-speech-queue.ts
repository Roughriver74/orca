// Unprompted speech — agent notices and Jarvis's own replies to a background task finishing —
// must never preempt what is playing: the panel cuts current playback the moment audio with a
// new utteranceId arrives. So these lines wait here for a pause and then play one after another.
// Pauses are signalled explicitly by the dialogue (playback ended), never by a bare state change:
// a barge-in also lands in 'listening', and that is the user talking, not a pause.

import type { CompanionConversationState } from '../../shared/companion-types'

export type CompanionUnpromptedSpeech = {
  /** 'notice' — idle-only (mid-conversation the brain is briefed instead); 'reply' — Jarvis's
   *  own words, also spoken inside an open conversation once it is listening again. */
  kind: 'notice' | 'reply'
  text: string
}

export type CompanionUnpromptedSpeechQueue = {
  enqueue(item: CompanionUnpromptedSpeech): void
  /** Call at a pause (playback ended); plays the next line if nothing else holds the speaker. */
  drain(): void
  clear(): void
}

export function createCompanionUnpromptedSpeechQueue(deps: {
  getState: () => CompanionConversationState
  /** A reply stream or another line holds the speaker (streaming or still playing). */
  isSpeakerBusy: () => boolean
  /** Returns whether audio started; false (no TTS) means the line is done with right away. */
  play: (item: CompanionUnpromptedSpeech) => boolean
}): CompanionUnpromptedSpeechQueue {
  const pending: CompanionUnpromptedSpeech[] = []

  function drain(): void {
    while (pending.length > 0 && !deps.isSpeakerBusy()) {
      const state = deps.getState()
      const head = pending[0]
      if (head.kind === 'notice' && state !== 'idle') {
        pending.shift()
        continue
      }
      if (state !== 'idle' && state !== 'listening') {
        return
      }
      pending.shift()
      if (deps.play(head)) {
        return
      }
    }
  }

  return {
    enqueue: (item) => {
      pending.push(item)
      drain()
    },
    drain,
    clear: () => {
      pending.length = 0
    }
  }
}
