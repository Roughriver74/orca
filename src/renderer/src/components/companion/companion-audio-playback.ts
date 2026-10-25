import { useCallback, useEffect, useRef } from 'react'
import type { CompanionAudioChunk } from '../../../../shared/companion-types'
import { rmsLevel } from './companion-voice-barge-in-monitor'

// ≈ −10 dB: clearly quieter so the user hears they were noticed, still intelligible if it
// was a false alarm; the time constant keeps the change from clicking.
const DUCKED_GAIN = 0.3
const DUCK_TIME_CONSTANT_SECONDS = 0.05

type CompanionAudioPlaybackCallbacks = {
  /** Fired when an utterance starts playing (first chunk scheduled) or finishes/stops —
   *  drives pausing/resuming the mic feed so the companion never transcribes its own voice. */
  onPlaybackChange?: (playing: boolean) => void
}

/**
 * Schedules TTS chunks gaplessly via WebAudio, one utterance "in flight" at a
 * time (a turn-based conversation never overlaps two replies). Out-of-order
 * chunks are buffered until contiguous by `seq`; a new utteranceId interrupts
 * whatever is currently queued/playing. Reports playback progress back to main
 * via `companion:audio-state` so the Brain/TTS slice can track delivery.
 * `getOutputLevel` exposes what is being played right now — the echo reference voice
 * barge-in compares the mic against (measured after ducking: what the speakers emit).
 * `setDucked` softens the reply while main confirms a possible barge-in; every new
 * utterance starts at full volume.
 */
export function useCompanionAudioPlayback({ onPlaybackChange }: CompanionAudioPlaybackCallbacks): {
  getOutputLevel: () => number
  setDucked: (ducked: boolean) => void
} {
  const contextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserBufferRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const duckGainRef = useRef<GainNode | null>(null)
  const duckedRef = useRef(false)
  const activeUtteranceIdRef = useRef<string | null>(null)
  const nextExpectedSeqRef = useRef(0)
  const pendingChunksRef = useRef(new Map<number, CompanionAudioChunk>())
  const cursorTimeRef = useRef(0)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const sawFinalRef = useRef(false)
  const pendingSourceCountRef = useRef(0)

  const getContext = useCallback((): AudioContext => {
    if (!contextRef.current) {
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      analyser.connect(context.destination)
      contextRef.current = context
      analyserRef.current = analyser
      analyserBufferRef.current = new Float32Array(analyser.fftSize)
      const duckGain = context.createGain()
      duckGain.connect(analyser)
      duckGainRef.current = duckGain
    }
    return contextRef.current
  }, [])

  const getOutputLevel = useCallback((): number => {
    const analyser = analyserRef.current
    const buffer = analyserBufferRef.current
    if (!analyser || !buffer || activeUtteranceIdRef.current === null) {
      return 0
    }
    analyser.getFloatTimeDomainData(buffer)
    return rmsLevel(buffer)
  }, [])

  const setDucked = useCallback((ducked: boolean): void => {
    const duckGain = duckGainRef.current
    const context = contextRef.current
    if (!duckGain || !context || duckedRef.current === ducked) {
      return
    }
    duckedRef.current = ducked
    duckGain.gain.setTargetAtTime(
      ducked ? DUCKED_GAIN : 1,
      context.currentTime,
      DUCK_TIME_CONSTANT_SECONDS
    )
  }, [])

  const finishUtterance = useCallback(
    (utteranceId: string): void => {
      if (activeUtteranceIdRef.current !== utteranceId) {
        return
      }
      activeUtteranceIdRef.current = null
      pendingChunksRef.current.clear()
      onPlaybackChange?.(false)
      void window.api.companion.reportAudioState({ utteranceId, state: 'ended' })
    },
    [onPlaybackChange]
  )

  const scheduleChunk = useCallback(
    (utteranceId: string, chunk: CompanionAudioChunk): void => {
      const context = getContext()
      const buffer = context.createBuffer(1, chunk.pcm.length, chunk.sampleRate)
      buffer.getChannelData(0).set(chunk.pcm)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(duckGainRef.current ?? context.destination)

      const startAt = Math.max(cursorTimeRef.current, context.currentTime)
      cursorTimeRef.current = startAt + buffer.duration
      pendingSourceCountRef.current += 1
      activeSourcesRef.current.push(source)
      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source)
        pendingSourceCountRef.current -= 1
        if (chunk.final) {
          sawFinalRef.current = true
        }
        if (sawFinalRef.current && pendingSourceCountRef.current === 0) {
          finishUtterance(utteranceId)
        }
      }
      source.start(startAt)
    },
    [finishUtterance, getContext]
  )

  const drainContiguousChunks = useCallback(
    (utteranceId: string): void => {
      let next = pendingChunksRef.current.get(nextExpectedSeqRef.current)
      while (next) {
        pendingChunksRef.current.delete(nextExpectedSeqRef.current)
        nextExpectedSeqRef.current += 1
        scheduleChunk(utteranceId, next)
        next = pendingChunksRef.current.get(nextExpectedSeqRef.current)
      }
    },
    [scheduleChunk]
  )

  const stopAll = useCallback(
    (reportStoppedFor?: string): void => {
      for (const source of activeSourcesRef.current) {
        source.onended = null
        try {
          source.stop()
        } catch {
          // Why: stopping a source that already finished naturally throws — harmless.
        }
      }
      activeSourcesRef.current = []
      pendingSourceCountRef.current = 0
      pendingChunksRef.current.clear()
      cursorTimeRef.current = contextRef.current?.currentTime ?? 0
      const previousUtteranceId = activeUtteranceIdRef.current
      activeUtteranceIdRef.current = null
      if (previousUtteranceId) {
        onPlaybackChange?.(false)
        void window.api.companion.reportAudioState({
          utteranceId: reportStoppedFor ?? previousUtteranceId,
          state: 'stopped'
        })
      }
    },
    [onPlaybackChange]
  )

  const handleAudioChunk = useCallback(
    (chunk: CompanionAudioChunk): void => {
      if (activeUtteranceIdRef.current !== chunk.utteranceId) {
        stopAll()
        activeUtteranceIdRef.current = chunk.utteranceId
        nextExpectedSeqRef.current = 0
        sawFinalRef.current = false
        const context = getContext()
        cursorTimeRef.current = context.currentTime
        duckedRef.current = false
        duckGainRef.current?.gain.cancelScheduledValues(0)
        duckGainRef.current?.gain.setValueAtTime(1, context.currentTime)
        onPlaybackChange?.(true)
        void window.api.companion.reportAudioState({
          utteranceId: chunk.utteranceId,
          state: 'playing'
        })
      }
      pendingChunksRef.current.set(chunk.seq, chunk)
      drainContiguousChunks(chunk.utteranceId)
    },
    [drainContiguousChunks, getContext, onPlaybackChange, stopAll]
  )

  const handleAudioStop = useCallback(
    (payload: { utteranceId?: string }): void => {
      if (!payload.utteranceId || payload.utteranceId === activeUtteranceIdRef.current) {
        stopAll(payload.utteranceId)
      }
    },
    [stopAll]
  )

  useEffect(() => {
    const offChunk = window.api.companion.onAudioChunk(handleAudioChunk)
    const offStop = window.api.companion.onAudioStop(handleAudioStop)
    return () => {
      offChunk()
      offStop()
      stopAll()
      void contextRef.current?.close()
      contextRef.current = null
      analyserRef.current = null
      analyserBufferRef.current = null
      duckGainRef.current = null
      duckedRef.current = false
    }
  }, [handleAudioChunk, handleAudioStop, stopAll])

  return { getOutputLevel, setDucked }
}
