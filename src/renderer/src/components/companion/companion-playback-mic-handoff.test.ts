// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { CompanionSettings } from '../../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../../shared/constants'

const startVoiceMonitor = vi.fn(async () => undefined)
const stopVoiceMonitor = vi.fn(async () => null)
let capturedOnPlaybackChange: ((playing: boolean) => void) | null = null

vi.mock('./companion-voice-barge-in-monitor', () => ({
  useCompanionVoiceBargeInMonitor: () => ({ start: startVoiceMonitor, stop: stopVoiceMonitor })
}))

vi.mock('./companion-audio-playback', () => ({
  useCompanionAudioPlayback: ({
    onPlaybackChange
  }: {
    onPlaybackChange?: (playing: boolean) => void
  }) => {
    capturedOnPlaybackChange = onPlaybackChange ?? null
    return { getOutputLevel: () => 0 }
  }
}))

// vi.mock calls above are hoisted ahead of this static import by vitest's transform.
import { useCompanionPlaybackMicHandoff } from './companion-playback-mic-handoff'

function settingsWith(overrides: Partial<CompanionSettings>): CompanionSettings {
  return { ...getDefaultCompanionSettings(), ...overrides }
}

function renderHandoff(settings: CompanionSettings): {
  stopCapture: Mock
  startCapture: Mock
} {
  const stopCapture = vi.fn()
  const startCapture = vi.fn(async () => undefined)
  renderHook(() => {
    const settingsRef = useRef(settings)
    settingsRef.current = settings
    const isActiveRef = useRef(true)
    const isPlayingAudioRef = useRef(false)
    const hasAudioSinceLastFinalRef = useRef(false)
    return useCompanionPlaybackMicHandoff({
      sessionId: 'session-1',
      settingsRef,
      isActiveRef,
      isPlayingAudioRef,
      hasAudioSinceLastFinalRef,
      startCapture,
      stopCapture
    })
  })
  return { stopCapture, startCapture }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    api: {
      companion: { getSettings: vi.fn(async () => getDefaultCompanionSettings()) },
      speech: { feedAudio: vi.fn(async () => undefined) }
    }
  })
  startVoiceMonitor.mockClear()
  stopVoiceMonitor.mockClear()
  capturedOnPlaybackChange = null
})

describe('useCompanionPlaybackMicHandoff', () => {
  it('wake mode + voice barge-in: runs the echo monitor alongside STT capture, never pausing it', () => {
    const settings = settingsWith({
      voiceBargeIn: true,
      wake: { ...getDefaultCompanionSettings().wake, enabled: true }
    })
    const { stopCapture } = renderHandoff(settings)

    act(() => {
      capturedOnPlaybackChange?.(true)
    })

    // STT must keep running (it's the only thing that can hear "Джарвис, …") while the
    // echo-margin monitor also runs so a later wake-phrase match can be confirmed as real
    // speech, not Jarvis's own TTS coming back through the mic.
    expect(stopCapture).not.toHaveBeenCalled()
    expect(startVoiceMonitor).toHaveBeenCalledTimes(1)
  })

  it('stops the echo monitor once playback ends in wake mode, discarding its preRoll (STT already heard it live)', async () => {
    const settings = settingsWith({
      voiceBargeIn: true,
      wake: { ...getDefaultCompanionSettings().wake, enabled: true }
    })
    const { startCapture } = renderHandoff(settings)

    act(() => {
      capturedOnPlaybackChange?.(true)
    })
    await act(async () => {
      capturedOnPlaybackChange?.(false)
      await Promise.resolve()
    })

    expect(stopVoiceMonitor).toHaveBeenCalledTimes(1)
    // STT capture was never paused here, so it must not be (re)started either.
    expect(startCapture).not.toHaveBeenCalled()
  })

  it('plain voice barge-in (wake mode off): still pauses STT capture and starts the monitor', () => {
    const settings = settingsWith({ voiceBargeIn: true })
    const { stopCapture } = renderHandoff(settings)

    act(() => {
      capturedOnPlaybackChange?.(true)
    })

    expect(stopCapture).toHaveBeenCalledTimes(1)
    expect(startVoiceMonitor).toHaveBeenCalledTimes(1)
  })

  it('wake mode without voice barge-in: pauses STT capture and never starts the monitor', () => {
    const settings = settingsWith({
      voiceBargeIn: false,
      wake: { ...getDefaultCompanionSettings().wake, enabled: true }
    })
    const { stopCapture } = renderHandoff(settings)

    act(() => {
      capturedOnPlaybackChange?.(true)
    })

    expect(stopCapture).toHaveBeenCalledTimes(1)
    expect(startVoiceMonitor).not.toHaveBeenCalled()
  })
})
