// "Слово-сигнал" mode: the user thinks aloud with long pauses, so a finalized segment no
// longer means "send". Segments that already passed voice focus and the wake gate pile up
// here until one ends on an end keyword ("…, думай"), which is stripped before the whole
// request reaches the brain. A silence of `fallbackPauseSeconds` after the last segment
// sends it anyway, so a forgotten keyword never strands a request.

import type { CompanionEndKeywordSettings } from '../../shared/companion-types'
import { utteranceWordSpans } from './companion-wake-gate'

/** `text` without its trailing end keyword, or `null` when it does not end on one.
 *  Case, ё and punctuation around the keyword are ignored ("Всё." / "думай!"). */
export function stripCompanionEndKeyword(text: string, keywords: readonly string[]): string | null {
  const spans = utteranceWordSpans(text)
  let cutAt: number | null = null
  for (const keyword of keywords) {
    const expected = utteranceWordSpans(keyword).map((span) => span.word)
    if (expected.length === 0 || expected.length > spans.length) {
      continue
    }
    const tail = spans.slice(spans.length - expected.length)
    if (tail.every((span, index) => span.word === expected[index])) {
      cutAt = Math.min(cutAt ?? tail[0].start, tail[0].start)
    }
  }
  if (cutAt === null) {
    return null
  }
  // Why only clause punctuation: "Сделай отчёт. Думай." keeps its full stop.
  return text.slice(0, cutAt).replace(/[\s,;:—–-]+$/u, '')
}

export type CompanionEndKeywordBuffer = {
  /** One gated utterance; returns the request to send now, or `null` while it is held. */
  push(text: string): string | null
  /** A request is being held, waiting for its end keyword or the fallback pause. */
  isPending(): boolean
  /** Hotkey "send now": returns the held request (null if none) and clears it. */
  take(): string | null
  /** The hotkey cut the current segment short — send it as-is instead of holding it. */
  sendNextSegment(): void
  /** Mic meter speech edges: talking pauses the fallback timer, silence restarts it. */
  reportUserSpeaking(speaking: boolean): void
  clear(): void
}

export function createCompanionEndKeywordBuffer(deps: {
  getSettings: () => CompanionEndKeywordSettings
  /** The fallback pause elapsed: send this held request. */
  onFallback: (text: string) => void
}): CompanionEndKeywordBuffer {
  let held = ''
  let sendNext = false
  let timer: ReturnType<typeof setTimeout> | null = null

  function stopTimer(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  function startTimer(): void {
    stopTimer()
    timer = setTimeout(() => {
      timer = null
      const text = take()
      if (text !== null) {
        deps.onFallback(text)
      }
    }, deps.getSettings().fallbackPauseSeconds * 1000)
  }

  function take(): string | null {
    stopTimer()
    sendNext = false
    const text = held
    held = ''
    return text === '' ? null : text
  }

  function push(text: string): string | null {
    const settings = deps.getSettings()
    const stripped = settings.enabled ? stripCompanionEndKeyword(text, settings.words) : null
    const piece = (stripped ?? text).trim()
    held = held === '' ? piece : piece === '' ? held : `${held} ${piece}`
    if (stripped !== null || sendNext || !settings.enabled) {
      return take()
    }
    if (held !== '') {
      startTimer()
    }
    return null
  }

  function reportUserSpeaking(speaking: boolean): void {
    if (held === '') {
      return
    }
    if (speaking) {
      stopTimer()
    } else {
      startTimer()
    }
  }

  function clear(): void {
    take()
  }

  return {
    push,
    isPending: () => held !== '',
    take,
    sendNextSegment: () => {
      sendNext = true
    },
    reportUserSpeaking,
    clear
  }
}
