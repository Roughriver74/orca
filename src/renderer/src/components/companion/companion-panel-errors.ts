import { translate } from '@/i18n/i18n'

export type CompanionPanelError =
  | { kind: 'mic-permission'; message: string }
  | { kind: 'generic'; message: string }

export function micPermissionError(): CompanionPanelError {
  return {
    kind: 'mic-permission',
    message: translate(
      'companion.panel.micPermissionDenied',
      'Нет доступа к микрофону — разреши в Системные настройки → Конфиденциальность → Микрофон'
    )
  }
}

/** Turns a failed listen start into something a person can act on instead of a raw IPC error. */
export function describeListenStartError(err: unknown): CompanionPanelError {
  // Why: TCC can report "granted" while Chromium still rejects getUserMedia (NotAllowedError).
  if (err instanceof DOMException && err.name === 'NotAllowedError') {
    return micPermissionError()
  }
  const message = err instanceof Error ? err.message : String(err)
  // Main reports `Model not ready: <status>` while the STT model is still downloading or missing.
  if (/Model not ready: downloading/.test(message)) {
    return {
      kind: 'generic',
      message: translate(
        'companion.panel.sttDownloading',
        'Модель распознавания ещё скачивается — нажми клавишу ещё раз через минуту'
      )
    }
  }
  if (/Model not ready/.test(message)) {
    return {
      kind: 'generic',
      message: translate(
        'companion.panel.sttMissing',
        'Модель распознавания не установлена — выбери её в Настройки → Companion'
      )
    }
  }
  return { kind: 'generic', message }
}
