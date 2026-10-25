// "Always listening, answers only when addressed": decides, per finalized utterance,
// whether it was meant for Jarvis. The room may have a TV on or people talking to each
// other, so by default nothing reaches the brain. An utterance gets through when:
//   - it contains a wake phrase ("Джарвис, …"): the text after the phrase is the request,
//     whatever came before it (TV chatter merged into the same utterance) is dropped;
//   - or it arrives in the short follow-up window after Jarvis answered or was addressed,
//     so a conversation does not need the name every turn. Follow-ups must also be at
//     least half as loud as the utterance that addressed Jarvis: a TV across the room
//     reaches the mic much quieter than the person who just spoke to it.
// While Jarvis is talking or thinking only the wake phrase counts, so neither the TV nor
// Jarvis's own voice leaking into the mic can interrupt or supersede a turn.
// With the keyword spotter on (wake.keywordSpotter, model loaded) a wake phrase in the
// transcript only counts if the spotter also heard one acoustically during that utterance:
// both detectors must agree, so a near-miss from either one alone ("в эту пятницу" in the
// transcript, a TV "Джарвин" in the audio) does not address Jarvis.

import type {
  CompanionConversationState,
  CompanionWakeSettings
} from '../../shared/companion-types'

export type CompanionWakeDecision =
  /** Send `text` to the brain; `addressed` = it carried the wake phrase. */
  | { kind: 'pass'; text: string; addressed: boolean }
  /** Just the wake phrase ("Джарвис!"): wait for the request without the name. */
  | { kind: 'wake-only' }
  | { kind: 'ignore' }

export type CompanionWakeUtteranceContext = {
  state: CompanionConversationState
  /** Peak mic meter level over the utterance (0..1), when the panel measured it. */
  level?: number
  /** An end-keyword request (companion-end-keyword.ts) is still being dictated: this
   *  utterance continues an address that already passed, so it needs no wake phrase. */
  continuing?: boolean
}

/** After an explicit address (hotkey or bare wake phrase) the request may follow a pause. */
const ADDRESSED_WINDOW_MS = 8000
const FOLLOW_UP_LEVEL_RATIO = 0.5
/** A spotter hit is spent by the next finalized utterance — the one it was spoken in. The
 *  final lands after the rest of the utterance plus the end-of-utterance pause, and the
 *  offline recognizer flushes at least every 30 s, so a hit older than this is stale. */
const KEYWORD_PENDING_MS = 60_000

export type UtteranceWordSpan = { word: string; start: number; end: number }

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е')
}

/** Lowercased, ё-folded words of `text` with their character offsets; punctuation skipped. */
export function utteranceWordSpans(text: string): UtteranceWordSpan[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), (match) => {
    const start = match.index ?? 0
    return { word: normalizeWord(match[0]), start, end: start + match[0].length }
  })
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      current.push(Math.min(previous[j] + 1, current[j - 1] + 1, substitution))
    }
    previous = current
  }
  return previous[b.length]
}

/** Tolerates what STT does to a name: case endings ("Джарвису") and one-letter slips ("Жарвис"). */
function wordMatches(heard: string, expected: string): boolean {
  if (heard === expected) {
    return true
  }
  if (expected.length >= 4 && heard.startsWith(expected) && heard.length - expected.length <= 2) {
    return true
  }
  const allowedEdits = expected.length >= 8 ? 2 : expected.length >= 5 ? 1 : 0
  return allowedEdits > 0 && editDistance(heard, expected) <= allowedEdits
}

/** Finds the first wake phrase in `utterance`; `remainder` is the request after it,
 *  `start` the phrase's character offset (0 = the utterance opens with it). */
export function findWakePhrase(
  utterance: string,
  phrases: readonly string[]
): { remainder: string; start: number } | null {
  const spans = utteranceWordSpans(utterance)
  let earliest: { start: number; end: number } | null = null
  for (const phrase of phrases) {
    const expected = utteranceWordSpans(phrase).map((span) => span.word)
    if (expected.length === 0) {
      continue
    }
    for (let start = 0; start + expected.length <= spans.length; start++) {
      if (earliest && start >= earliest.start) {
        break
      }
      if (expected.every((word, offset) => wordMatches(spans[start + offset].word, word))) {
        earliest = { start, end: spans[start + expected.length - 1].end }
        break
      }
    }
  }
  if (!earliest) {
    return null
  }
  return {
    remainder: utterance
      .slice(earliest.end)
      .replace(/^[\s\p{P}]+/u, '')
      .trim(),
    start: spans[earliest.start].start
  }
}

export type CompanionWakeGate = {
  decide(text: string, context: CompanionWakeUtteranceContext): CompanionWakeDecision
  /** Hotkey/notice opened the panel: the next utterance needs no wake phrase. */
  address(): void
  /** Panel closed or "стоп": back to waiting for the wake phrase. */
  dismiss(): void
  onStateChange(state: CompanionConversationState): void
  /** True while a wake phrase/hotkey address is still in its follow-up window — the
   *  voice-focus policy (companion-voice-focus.ts) uses this to tell an already-
   *  addressed exchange ("hotkey" mode, lenient) from pure background listening
   *  ("wake" mode, strict) when deciding whether to drop a non-owner segment. */
  isAddressed(): boolean
  /** The keyword spotter heard a wake phrase in the audio just now. */
  noteKeyword(): void
}

export function createCompanionWakeGate(deps: {
  getSettings: () => CompanionWakeSettings
  now: () => number
  /** True while the keyword spotter runs; its hits then gate transcript matches. */
  isKeywordSpotterActive?: () => boolean
}): CompanionWakeGate {
  let followUpUntil: number | null = null
  let addresserLevel: number | null = null
  let previousState: CompanionConversationState = 'idle'
  let keywordHeardAt: number | null = null

  function openFollowUp(durationMs: number): void {
    followUpUntil = durationMs > 0 ? deps.now() + durationMs : null
  }

  function loudEnough(level: number | undefined): boolean {
    return (
      addresserLevel === null ||
      level === undefined ||
      level >= FOLLOW_UP_LEVEL_RATIO * addresserLevel
    )
  }

  function decide(text: string, context: CompanionWakeUtteranceContext): CompanionWakeDecision {
    const settings = deps.getSettings()
    if (!settings.enabled) {
      return { kind: 'pass', text, addressed: false }
    }
    const keywordHeard =
      keywordHeardAt !== null && deps.now() - keywordHeardAt <= KEYWORD_PENDING_MS
    keywordHeardAt = null
    const transcriptMatch = findWakePhrase(text, settings.phrases)
    const match = deps.isKeywordSpotterActive?.() && !keywordHeard ? null : transcriptMatch
    const continuing =
      context.continuing === true && context.state === 'listening' && loudEnough(context.level)
    // Mid-request, a name inside the sentence ("сделай, чтобы Джарвис…") is just a word —
    // only one that opens the utterance re-addresses (and can still say "стоп").
    if (match && !(continuing && match.start > 0)) {
      if (context.level !== undefined) {
        addresserLevel = context.level
      }
      if (match.remainder === '') {
        openFollowUp(Math.max(settings.followUpMs, ADDRESSED_WINDOW_MS))
        return { kind: 'wake-only' }
      }
      followUpUntil = null
      return { kind: 'pass', text: match.remainder, addressed: true }
    }
    const inFollowUp =
      context.state === 'listening' && followUpUntil !== null && deps.now() <= followUpUntil
    if (continuing || (inFollowUp && loudEnough(context.level))) {
      followUpUntil = null
      return { kind: 'pass', text, addressed: false }
    }
    return { kind: 'ignore' }
  }

  function address(): void {
    addresserLevel = null
    openFollowUp(Math.max(deps.getSettings().followUpMs, ADDRESSED_WINDOW_MS))
  }

  function isAddressed(): boolean {
    return followUpUntil !== null && deps.now() <= followUpUntil
  }
  function dismiss(): void {
    followUpUntil = null
  }

  function onStateChange(state: CompanionConversationState): void {
    if (state === 'listening' && (previousState === 'thinking' || previousState === 'speaking')) {
      openFollowUp(deps.getSettings().followUpMs)
    }
    if (state === 'idle') {
      followUpUntil = null
      addresserLevel = null
    }
    previousState = state
  }

  function noteKeyword(): void {
    keywordHeardAt = deps.now()
  }

  return { decide, address, dismiss, onStateChange, isAddressed, noteKeyword }
}
