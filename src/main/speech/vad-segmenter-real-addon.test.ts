// Real-native-addon integration test for the VAD engine itself: loads the actual
// sherpa-onnx native addon and the real Silero VAD model and feeds it speech-shaped
// audio with trailing silence, verifying a real segment comes out with the expected
// shape. This is the deepest check runnable under plain Vitest — vad-worker.ts (which
// VadSegmentationService spawns as a worker_thread) only exists as compiled JS inside a
// built app (out/main/vad-worker.js, see electron.vite.config.ts), so the full
// worker-thread path needs the Playwright+fake-mic e2e harness against a built app (see
// tests/e2e/companion-dangling-utterance-hold.spec.ts for that pattern) — that is the
// remaining piece for "Background built-app e2e... ends correctly via VAD" once
// CompanionPanel.tsx is wired (pending hand-off from the sibling fixing wake listening).
//
// Skips (not fails) when the pinned VAD model is not present on this machine — same
// convention as the GigaAM e2e spec's SOURCE_MODEL_DIR check.
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { VadSegmenter, type VadBinding, type VadSegment } from './vad-segmenter'

const VAD_MODEL_PATH = '/Users/evgenijsikunov/assistant/voice-lab/focus/models/silero_vad_v5.onnx'
const hasModel = existsSync(VAD_MODEL_PATH)

function speechLikeTone(seconds: number, sampleRate: number): Float32Array {
  // Why a modulated tone and not pure silence/noise: Silero VAD is a learned speech
  // classifier, not an energy gate — a steady tone or white noise alone does not read as
  // speech. A frequency/amplitude-modulated tone in the human voice formant range reliably
  // triggers it without needing a real recorded voice file in-repo (kept out of the repo
  // on purpose — see the eval script under /Users/evgenijsikunov/assistant/voice-lab/focus/
  // for real `say`-synthesized voices and the full owner/other-speaker/TV-noise matrix).
  const n = Math.round(seconds * sampleRate)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i += 1) {
    const t = i / sampleRate
    const f0 = 140 + 40 * Math.sin(2 * Math.PI * 3 * t)
    const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4 * t)
    out[i] = 0.3 * envelope * Math.sin(2 * Math.PI * f0 * t)
  }
  return out
}

describe.skipIf(!hasModel)(
  'VadSegmenter (real sherpa-onnx native addon, real Silero VAD v5)',
  () => {
    // oxlint-disable-next-line typescript-eslint/no-explicit-any -- sherpa-onnx native addon has no type definitions
    const sherpa: any = require('sherpa-onnx-darwin-arm64')
    const binding = sherpa as VadBinding

    it('segments speech-like audio and fires end-of-utterance after the configured trailing silence', () => {
      const sampleRate = 16000
      const endOfUtteranceSeconds = 1
      const segmenter = new VadSegmenter(binding, {
        modelPath: VAD_MODEL_PATH,
        sampleRate,
        endOfUtteranceSeconds,
        maxUtteranceSeconds: 30
      })

      const windowSize = 512
      const speech = speechLikeTone(2, sampleRate)
      const trailingSilence = new Float32Array(2.5 * sampleRate)
      const audio = new Float32Array(speech.length + trailingSilence.length)
      audio.set(speech, 0)
      audio.set(trailingSilence, speech.length)

      const segments: VadSegment[] = []
      for (let i = 0; i + windowSize <= audio.length; i += windowSize) {
        segments.push(...segmenter.feed(audio.subarray(i, i + windowSize)))
      }

      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0]?.samples.length).toBeGreaterThan(0)
      // The detected segment should be roughly the speech duration, not the full
      // speech+silence feed — confirms the VAD trims trailing silence, not just echoes input.
      expect(segments[0]!.samples.length / sampleRate).toBeLessThan(
        speech.length / sampleRate + 0.5
      )
    })

    it('finalizeNow() force-flushes an in-progress segment on real Silero output', () => {
      const sampleRate = 16000
      const segmenter = new VadSegmenter(binding, {
        modelPath: VAD_MODEL_PATH,
        sampleRate,
        // Why 30s: long enough that the segment would not finish naturally within this
        // test's short feed, so any reported segment must have come from finalizeNow().
        endOfUtteranceSeconds: 30,
        maxUtteranceSeconds: 60
      })

      const windowSize = 512
      const speech = speechLikeTone(2, sampleRate)
      for (let i = 0; i + windowSize <= speech.length; i += windowSize) {
        segmenter.feed(speech.subarray(i, i + windowSize))
      }

      const forced = segmenter.finalizeNow()

      expect(forced.length).toBeGreaterThan(0)
      expect(forced[0]?.samples.length).toBeGreaterThan(0)
    })
  }
)
