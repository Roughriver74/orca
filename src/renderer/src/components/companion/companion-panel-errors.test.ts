import { describe, expect, it } from 'vitest'
import { describeListenStartError } from './companion-panel-errors'

const ipcError = (detail: string) =>
  new Error(`Error invoking remote method 'speech:startDictation': Error: ${detail}`)

describe('describeListenStartError', () => {
  it('asks to retry instead of showing the raw IPC error while the model downloads', () => {
    const error = describeListenStartError(ipcError('Model not ready: downloading'))
    expect(error.kind).toBe('generic')
    expect(error.message).not.toContain('speech:startDictation')
    expect(error.message).toContain('скачивается')
  })

  it('points to settings when the model is missing', () => {
    expect(describeListenStartError(ipcError('Model not ready: missing')).message).toContain(
      'Companion'
    )
  })

  it('maps a Chromium mic denial to the permission banner', () => {
    const denied = new DOMException('Permission denied', 'NotAllowedError')
    expect(describeListenStartError(denied).kind).toBe('mic-permission')
  })

  it('keeps unknown errors verbatim', () => {
    expect(describeListenStartError(new Error('boom')).message).toBe('boom')
  })
})
