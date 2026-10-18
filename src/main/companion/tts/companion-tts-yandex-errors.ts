// Classifies everything that can go wrong talking to Yandex SpeechKit into a small set
// of codes the service can act on (retry locally via Silero vs. not) and a Russian
// sentence a person can read in the panel — raw fetch/HTTP text is either English or a
// bare status code, neither fit to speak or show as-is.

export type CompanionTtsYandexErrorCode = 'auth' | 'quota' | 'network' | 'server' | 'unknown'

export class CompanionTtsYandexError extends Error {
  constructor(
    readonly code: CompanionTtsYandexErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'CompanionTtsYandexError'
  }
}

/** Maps an HTTP response status from either SpeechKit API to an error code. */
export function classifyYandexHttpStatus(status: number): CompanionTtsYandexErrorCode {
  if (status === 401 || status === 403) {
    return 'auth'
  }
  if (status === 429) {
    return 'quota'
  }
  if (status >= 500) {
    return 'server'
  }
  return 'unknown'
}

const YANDEX_ERROR_MESSAGES_RU: Record<CompanionTtsYandexErrorCode, string> = {
  auth: 'Яндекс SpeechKit отклонил ключ API — проверь его в настройках.',
  quota: 'Яндекс SpeechKit: превышен лимит запросов, пробую позже.',
  network: 'Нет связи с Яндекс SpeechKit — проверь интернет.',
  server: 'Яндекс SpeechKit временно недоступен.',
  unknown: 'Не получилось озвучить через Яндекс SpeechKit.'
}

export function describeYandexErrorRu(error: unknown): string {
  if (error instanceof CompanionTtsYandexError) {
    return YANDEX_ERROR_MESSAGES_RU[error.code]
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return YANDEX_ERROR_MESSAGES_RU.network
  }
  if (error instanceof TypeError) {
    // `fetch` rejects with a bare TypeError ("fetch failed") for DNS/connection failures.
    return YANDEX_ERROR_MESSAGES_RU.network
  }
  return YANDEX_ERROR_MESSAGES_RU.unknown
}
