import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CompanionSettings } from '../../../../shared/companion-types'
import { useCompanionAudioPlayback } from './companion-audio-playback'
import { useCompanionVoiceBargeInMonitor } from './companion-voice-barge-in-monitor'

type CompanionPlaybackMicHandoffDeps = {
  sessionId: string
  settingsRef: RefObject<CompanionSettings>
  isActiveRef: RefObject<boolean>
  isPlayingAudioRef: RefObject<boolean>
  hasAudioSinceLastFinalRef: RefObject<boolean>
  startCapture: (options: { sessionId: string }) => Promise<unknown>
  stopCapture: () => void
}

/**
 * Owns what the mic does while a reply plays. Default: STT capture pauses so the companion
 * never transcribes itself. Voice barge-in: a separate monitor stream watches for the user
 * talking over Jarvis, and the words it heard are handed to STT once playback stops. Wake
 * mode + barge-in: STT keeps running through playback so a wake-phrase utterance
 * ("Джарвис, …") can interrupt — but with no headphones the mic hears Jarvis's own TTS
 * too, so the same echo-margin monitor used for plain voice barge-in also runs
 * concurrently here, purely to confirm real (non-echo) speech for
 * companion-dialogue.ts's `hasConfirmedRealSpeech()`; its own preRoll is discarded since
 * STT already heard the utterance live. Also plays the TTS audio.
 */
export function useCompanionPlaybackMicHandoff({
  sessionId,
  settingsRef,
  isActiveRef,
  isPlayingAudioRef,
  hasAudioSinceLastFinalRef,
  startCapture,
  stopCapture
}: CompanionPlaybackMicHandoffDeps): {
  listeningThroughPlaybackRef: RefObject<boolean>
  refreshSettings: () => void
} {
  const listeningThroughPlaybackRef = useRef(false)
  const playbackLevelRef = useRef<() => number>(() => 0)
  const setDuckedRef = useRef<(ducked: boolean) => void>(() => undefined)

  const { start: startVoiceMonitor, stop: stopVoiceMonitor } = useCompanionVoiceBargeInMonitor({
    getPlaybackLevel: useCallback(() => playbackLevelRef.current(), []),
    onDuckChange: useCallback((ducked: boolean) => setDuckedRef.current(ducked), [])
  })

  // Why re-read here: the panel hydrates settings once, but the barge-in/wake toggles
  // should apply from the next reply without reopening the panel.
  const refreshSettings = useCallback((): void => {
    void window.api.companion.getSettings().then((settings) => {
      settingsRef.current = settings
    })
  }, [settingsRef])

  const resumeCaptureAfterPlayback = useCallback(async (): Promise<void> => {
    refreshSettings()
    if (listeningThroughPlaybackRef.current) {
      listeningThroughPlaybackRef.current = false
      // Why discard the preRoll: wake mode's STT capture already heard this reply live —
      // this monitor instance only ran to confirm real speech for hasConfirmedRealSpeech().
      await stopVoiceMonitor()
      return
    }
    const preRoll = await stopVoiceMonitor()
    if (!isActiveRef.current || isPlayingAudioRef.current) {
      return
    }
    if (preRoll) {
      // Why: the words that barged in reached the monitor, not the paused STT capture.
      hasAudioSinceLastFinalRef.current = true
      await window.api.speech
        .feedAudio(preRoll.samples, preRoll.sampleRate, sessionId)
        .catch(() => undefined)
      if (!isActiveRef.current || isPlayingAudioRef.current) {
        return
      }
    }
    void startCapture({ sessionId })
  }, [
    hasAudioSinceLastFinalRef,
    isActiveRef,
    isPlayingAudioRef,
    refreshSettings,
    sessionId,
    startCapture,
    stopVoiceMonitor
  ])

  const { getOutputLevel, setDucked } = useCompanionAudioPlayback({
    onPlaybackChange: useCallback(
      (playing: boolean) => {
        isPlayingAudioRef.current = playing
        if (!playing) {
          void resumeCaptureAfterPlayback()
          return
        }
        const { voiceBargeIn, wake } = settingsRef.current
        if (wake.enabled && voiceBargeIn) {
          listeningThroughPlaybackRef.current = true
          void startVoiceMonitor()
          return
        }
        stopCapture()
        if (voiceBargeIn) {
          void startVoiceMonitor()
        }
      },
      [isPlayingAudioRef, resumeCaptureAfterPlayback, settingsRef, startVoiceMonitor, stopCapture]
    )
  })

  useEffect(() => {
    playbackLevelRef.current = getOutputLevel
    setDuckedRef.current = setDucked
  }, [getOutputLevel, setDucked])

  return { listeningThroughPlaybackRef, refreshSettings }
}
