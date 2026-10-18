import { useCallback, useEffect, useRef } from 'react'
import { buildAudioCaptureConstraints } from '@/components/dictation/microphone-devices'

// ~43ms at 48kHz: fine enough for the 300ms sustain window main's detector applies.
const FRAME_SIZE = 2048
// Covers the detector's sustain window plus IPC/stop latency, so the words that
// triggered the barge-in still reach STT.
const PRE_ROLL_MS = 1500

export type CompanionVoicePreRoll = {
  samples: Float32Array
  sampleRate: number
}

export function rmsLevel(samples: Float32Array): number {
  if (samples.length === 0) {
    return 0
  }
  let sumSquares = 0
  for (const sample of samples) {
    sumSquares += sample * sample
  }
  return Math.sqrt(sumSquares / samples.length)
}

type MonitorResources = {
  stream: MediaStream
  context: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
}

/**
 * Listens to the mic only while a reply plays (the STT capture is paused then, so the
 * companion never transcribes itself) and streams per-frame mic + playback levels to
 * main, which decides whether the user is talking over Jarvis. The stream asks for the
 * browser's echo cancellation, same as the STT capture. `stop()` returns the last
 * ~1.5s of mic audio when this monitor's frame was the one that barged in.
 */
export function useCompanionVoiceBargeInMonitor({
  getPlaybackLevel
}: {
  getPlaybackLevel: () => number
}): {
  start: () => Promise<void>
  stop: () => Promise<CompanionVoicePreRoll | null>
} {
  const sessionRef = useRef(0)
  const resourcesRef = useRef<MonitorResources | null>(null)
  const preRollRef = useRef<Float32Array[]>([])
  const preRollSamplesRef = useRef(0)
  const sampleRateRef = useRef(48_000)
  const bargedInSessionRef = useRef<number | null>(null)
  const lastReportRef = useRef<Promise<void>>(Promise.resolve())

  const release = useCallback((): void => {
    const resources = resourcesRef.current
    resourcesRef.current = null
    if (!resources) {
      return
    }
    resources.processor.onaudioprocess = null
    resources.processor.disconnect()
    resources.source.disconnect()
    if (resources.context.state !== 'closed') {
      void resources.context.close()
    }
    resources.stream.getTracks().forEach((track) => track.stop())
  }, [])

  const rememberPreRoll = useCallback((samples: Float32Array): void => {
    preRollRef.current.push(samples)
    preRollSamplesRef.current += samples.length
    const maxSamples = (sampleRateRef.current * PRE_ROLL_MS) / 1000
    while (
      preRollRef.current.length > 1 &&
      preRollSamplesRef.current - (preRollRef.current[0]?.length ?? 0) >= maxSamples
    ) {
      preRollSamplesRef.current -= preRollRef.current.shift()?.length ?? 0
    }
  }, [])

  const start = useCallback(async (): Promise<void> => {
    sessionRef.current += 1
    const session = sessionRef.current
    release()
    preRollRef.current = []
    preRollSamplesRef.current = 0
    bargedInSessionRef.current = null
    lastReportRef.current = Promise.resolve()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia(buildAudioCaptureConstraints(null))
    } catch (error) {
      // Why swallow: voice barge-in is best-effort; the hotkey barge-in still works.
      console.warn('[companion] voice barge-in mic unavailable', error)
      return
    }
    if (session !== sessionRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1)
    resourcesRef.current = { stream, context, source, processor }
    sampleRateRef.current = context.sampleRate
    if (context.state === 'suspended') {
      await context.resume()
    }
    if (session !== sessionRef.current) {
      return
    }

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (session !== sessionRef.current) {
        return
      }
      const samples = new Float32Array(event.inputBuffer.getChannelData(0))
      rememberPreRoll(samples)
      lastReportRef.current = window.api.companion
        .reportVoiceActivity({
          micLevel: rmsLevel(samples),
          playbackLevel: getPlaybackLevel(),
          durationMs: (samples.length / context.sampleRate) * 1000
        })
        .then((result) => {
          if (result.bargedIn) {
            bargedInSessionRef.current = session
          }
        })
        .catch(() => undefined)
    }
    source.connect(processor)
    // Why: a ScriptProcessorNode only runs while connected to a destination; it outputs silence.
    processor.connect(context.destination)
  }, [getPlaybackLevel, release, rememberPreRoll])

  const stop = useCallback(async (): Promise<CompanionVoicePreRoll | null> => {
    const endedSession = sessionRef.current
    sessionRef.current += 1
    release()
    const chunks = preRollRef.current
    const totalSamples = preRollSamplesRef.current
    preRollRef.current = []
    preRollSamplesRef.current = 0
    // Why await: main sends `audio-stop` before replying to the frame that barged in.
    await lastReportRef.current
    if (bargedInSessionRef.current !== endedSession || totalSamples === 0) {
      return null
    }
    const samples = new Float32Array(totalSamples)
    let offset = 0
    for (const chunk of chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    return { samples, sampleRate: sampleRateRef.current }
  }, [release])

  useEffect(() => {
    return () => {
      sessionRef.current += 1
      release()
    }
  }, [release])

  return { start, stop }
}
