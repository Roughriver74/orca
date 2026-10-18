import { useCallback, useEffect, useRef } from 'react'
import type { CompanionAudioChunk } from '../../../../shared/companion-types'

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
 */
export function useCompanionAudioPlayback({ onPlaybackChange }: CompanionAudioPlaybackCallbacks) {
  const contextRef = useRef<AudioContext | null>(null)
  const activeUtteranceIdRef = useRef<string | null>(null)
  const nextExpectedSeqRef = useRef(0)
  const pendingChunksRef = useRef(new Map<number, CompanionAudioChunk>())
  const cursorTimeRef = useRef(0)
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([])
  const sawFinalRef = useRef(false)
  const pendingSourceCountRef = useRef(0)

  const getContext = useCallback((): AudioContext => {
    contextRef.current ??= new AudioContext()
    return contextRef.current
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
      source.connect(context.destination)

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
        cursorTimeRef.current = getContext().currentTime
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
    }
  }, [handleAudioChunk, handleAudioStop, stopAll])
}
