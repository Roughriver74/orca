// Speaks a cached "thinking" phrase while a reply stays silent. Measured on a real turn
// (sonnet, tool use): ~16s of total silence before the first token — almost entirely
// Claude thinking/running tools, not our own pipeline (brain connection open + TTS
// request together added well under 1s). Rather than sitting in dead air, speak one of
// these — cached by companion-tts-yandex-cache.ts after the first real use, so repeats
// cost nothing — the moment either the brain opens its first tool call or this much time
// has passed with no text yet.

export const COMPANION_THINKING_ACK_PHRASES = [
  'Секунду, смотрю…',
  'Минутку…',
  'Сейчас, разбираюсь…'
]
export const COMPANION_THINKING_ACK_DELAY_MS = 1200

/** One of a small fixed set so companion-tts-yandex-cache.ts caches it after first use. */
export function pickCompanionThinkingAckPhrase(): string {
  const index = Math.floor(Math.random() * COMPANION_THINKING_ACK_PHRASES.length)
  return COMPANION_THINKING_ACK_PHRASES[index]
}

export type CompanionThinkingAckScheduler = {
  /** A real text delta arrived — cancels this turn's ack permanently. */
  onDelta(): void
  /** The brain opened a tool call — speaks the ack now if not already spoken/cancelled;
   *  a no-op on every call after the first (one ack per turn, however many tool calls). */
  onToolStart(): void
  /** The turn settled (final/error) or was superseded — clears any pending timer. */
  dispose(): void
}

/** Starts the delay timer immediately; call `dispose()` once the turn ends either way. */
export function scheduleCompanionThinkingAck(options: {
  speak: (phrase: string) => void
  isCurrent: () => boolean
  pickPhrase?: () => string
  delayMs?: number
}): CompanionThinkingAckScheduler {
  const pickPhrase = options.pickPhrase ?? pickCompanionThinkingAckPhrase
  let spoken = false
  let timer: NodeJS.Timeout | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
  const speakNow = (): void => {
    if (spoken) {
      return
    }
    spoken = true
    clearTimer()
    options.speak(pickPhrase())
  }
  timer = setTimeout(() => {
    timer = null
    if (options.isCurrent()) {
      speakNow()
    }
  }, options.delayMs ?? COMPANION_THINKING_ACK_DELAY_MS)

  return {
    onDelta: () => {
      spoken = true
      clearTimer()
    },
    onToolStart: speakNow,
    dispose: clearTimer
  }
}
