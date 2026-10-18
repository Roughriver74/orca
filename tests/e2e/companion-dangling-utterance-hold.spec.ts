// Validates the fix for: a finalized STT chunk that trails off mid-thought (ends on a
// comma/dash or on a conjunction/preposition/particle like "что"/"и"/"но") must not be
// sent to the brain immediately — it is held for up to CompanionUtteranceHold's 3s grace
// window, the panel shows "…жду продолжения", and the next finalized chunk is combined
// into it and submitted as ONE utterance once the combination completes a thought. See
// src/shared/companion-utterance-dangling.ts, src/shared/companion-utterance-hold.ts,
// src/renderer/src/components/companion/companion-utterance-hold-wiring.ts, and the
// endOfUtteranceMs -> endOfUtteranceSeconds rename in src/shared/constants.ts (commit
// 96c1c1809d). A second spec here covers the other half of that commit: the TTS speed
// slider's localized value and the end-of-utterance-seconds control render correctly.
//
// Background-only per tests/AGENTS.md: no window is revealed, no focus is stolen. The
// hold test runs the REAL companion pipeline end to end — the panel's own
// useAudioCapture -> getUserMedia -> speech:feedAudio -> the real GigaAM sherpa-onnx
// offline recognizer in stt-worker.ts -> speech:final -> CompanionUtteranceHold ->
// companion:reportUtterance. The only substitution is the microphone itself:
// navigator.mediaDevices.getUserMedia on the companion page is overridden to return a
// MediaStreamAudioDestinationNode that plays two WAV files recorded with `say -v
// Milena` (see the comment by SEG1_WAV below for why those specific fixtures).
//
// Requires a GigaAM model already downloaded to this machine's real Orca profile
// (~/Library/Application Support/orca/speech-models/gigaam-v3-e2e-rnnt-ru), copied into
// the isolated e2e profile — skips the hold test if that source is absent.

import { existsSync, readFileSync, cpSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { getDefaultCompanionSettings } from '../../src/shared/constants'

const SOURCE_MODEL_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'orca',
  'speech-models',
  'gigaam-v3-e2e-rnnt-ru'
)
const MODEL_ID = 'gigaam-v3-e2e-rnnt-ru'
const SCREENSHOT_DIR = '/Users/evgenijsikunov/assistant/voice-lab/verify'
mkdirSync(SCREENSHOT_DIR, { recursive: true })

// Why these two specific recordings: `say -v Milena "Я хотел сказать, что"` decodes
// through the real GigaAM model as "Я хотел сказать, что" — last word "что", no closing
// punctuation, which isCompanionUtteranceDangling holds (it's in
// DANGLING_TRAILING_WORDS). `say -v Milena "мы закончили работу"` decodes as "Мы
// закончили работу." — closed with a period, so appending it completes the thought and
// the hold-wiring hook submits the combination as a single utterance. Verified by
// decoding both through sherpa-onnx's real offline nemo-transducer recognizer with this
// repo's exact production config (buildNemoTransducerRecognizerConfig) before picking
// them. The originally-saved seg1.wav/seg2.wav ("Сделай коммит и" / "запусти тесты") do
// NOT reproduce the dangling condition through the real model — GigaAM's punctuation
// restoration closes "Сделай коммит и" with a period ("Сделай коми.") instead of
// leaving it open — so those fixture files were replaced in place with this verified
// pair; the paths are unchanged.
const SEG1_WAV = '/Users/evgenijsikunov/assistant/voice-lab/timing/seg1.wav'
const SEG2_WAV = '/Users/evgenijsikunov/assistant/voice-lab/timing/seg2.wav'

type CompanionTestWindow = {
  __companionFinals: string[]
  __companionUtterances: string[]
}

test('a dangling utterance is held and combined with its continuation into one reportUtterance call', async ({
  electronApp,
  orcaPage
}) => {
  test.skip(
    !existsSync(SOURCE_MODEL_DIR),
    `requires a pre-downloaded GigaAM model at ${SOURCE_MODEL_DIR}`
  )
  test.setTimeout(180_000)

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  cpSync(SOURCE_MODEL_DIR, path.join(userDataDir, 'speech-models', MODEL_ID), {
    recursive: true
  })

  await waitForSessionReady(orcaPage)

  // Why: enabling companion (matching the user's real hotkey setting) is what makes
  // `ensureCompanionWindowAlive()` create the panel — same setup as
  // companion-hotkey-fullscreen-overlay.spec.ts.
  await orcaPage.evaluate(async (defaultCompanion) => {
    const current = await window.api.settings.get()
    const companion = current.companion ?? defaultCompanion
    const settings = await window.api.settings.set({
      companion: { ...companion, enabled: true, hotkey: 'Alt+Enter' }
    })
    window.__store?.setState({ settings })
  }, getDefaultCompanionSettings())

  const companionPage = await expect
    .poll(
      async () =>
        electronApp.windows().find((candidate) => candidate.url().includes('companion.html')) ??
        null,
      { timeout: 10_000 }
    )
    .not.toBeNull()
    .then(() =>
      electronApp.windows().find((candidate) => candidate.url().includes('companion.html'))!
    )

  const seg1Base64 = readFileSync(SEG1_WAV).toString('base64')
  const seg2Base64 = readFileSync(SEG2_WAV).toString('base64')

  // Spies on the real window.api.companion.reportUtterance call the hold-wiring hook
  // makes (same pattern other e2e specs use to wrap a preload bridge method in-page,
  // e.g. worktree-jump-sleep-focus.spec.ts's window.api.pty.listSessions override), and
  // swaps the panel's microphone for a synthetic stream that plays seg1 once the real
  // capture pipeline actually attaches to it, then plays seg2 shortly after the real STT
  // pipeline finalizes seg1 as dangling.
  await companionPage.evaluate(
    ({ seg1Base64, seg2Base64 }) => {
      function base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i)
        }
        return bytes.buffer
      }

      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this closure runs in the companion renderer, which stamps these fields on window itself.
      const testWindow = window as unknown as CompanionTestWindow
      testWindow.__companionFinals = []
      testWindow.__companionUtterances = []

      const originalReportUtterance = window.api.companion.reportUtterance.bind(
        window.api.companion
      )
      window.api.companion.reportUtterance = (text, meta) => {
        testWindow.__companionUtterances.push(text)
        return originalReportUtterance(text, meta)
      }

      return (async () => {
        const synthCtx = new AudioContext()
        if (synthCtx.state === 'suspended') {
          await synthCtx.resume()
        }
        const seg1Buffer = await synthCtx.decodeAudioData(base64ToArrayBuffer(seg1Base64))
        const seg2Buffer = await synthCtx.decodeAudioData(base64ToArrayBuffer(seg2Base64))
        const dest = synthCtx.createMediaStreamDestination()

        function playBuffer(buffer: AudioBuffer): void {
          const source = synthCtx.createBufferSource()
          source.buffer = buffer
          source.connect(dest)
          source.start()
        }

        let seg2Scheduled = false
        window.api.speech.onFinalTranscript((data) => {
          if (data.sessionId !== 'companion') {
            return
          }
          testWindow.__companionFinals.push(data.text)
          // The silence-driven restart that flushed seg1 as a final has to finish
          // starting the NEW dictation session before seg2's audio can reach it — give
          // it a second of margin, comfortably inside the 3s hold grace window.
          if (!seg2Scheduled) {
            seg2Scheduled = true
            setTimeout(() => playBuffer(seg2Buffer), 1000)
          }
        })

        navigator.mediaDevices.getUserMedia = (async () => {
          // Why scheduled from inside the override, not before: the real capture
          // pipeline's own AudioContext only starts pulling samples from `dest.stream`
          // once this call resolves and it wires up createMediaStreamSource — starting
          // seg1 earlier risks it playing out before anything is listening.
          setTimeout(() => playBuffer(seg1Buffer), 300)
          return dest.stream
        }) as typeof navigator.mediaDevices.getUserMedia
      })()
    },
    { seg1Base64, seg2Base64 }
  )

  await orcaPage.evaluate(() => window.api.companion.toggle())
  await expect(companionPage.getByText('Слушаю…')).toBeVisible({ timeout: 10_000 })

  // seg1 ("Я хотел сказать, что") finalizes as dangling and is held, not submitted.
  await expect
    .poll(
      () =>
        companionPage.evaluate(
          () =>
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: companion renderer stamps __companionFinals on window itself, set above.
            (window as unknown as CompanionTestWindow).__companionFinals.length
        ),
      { timeout: 30_000, message: 'first final (seg1) never arrived from the real STT pipeline' }
    )
    .toBeGreaterThanOrEqual(1)

  await expect(companionPage.getByText('…жду продолжения')).toBeVisible({ timeout: 5_000 })
  expect(
    await companionPage.evaluate(
      () =>
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: companion renderer stamps __companionUtterances on window itself, set above.
        (window as unknown as CompanionTestWindow).__companionUtterances.length
    )
  ).toBe(0)

  await companionPage.screenshot({
    path: `${SCREENSHOT_DIR}/companion-holding-dangling-utterance.png`
  })

  // seg2 ("мы закончили работу") finalizes, completes the thought, and the hold-wiring
  // hook combines it with the held seg1 text into exactly ONE reportUtterance call.
  await expect
    .poll(
      () =>
        companionPage.evaluate(
          () =>
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: companion renderer stamps __companionFinals on window itself, set above.
            (window as unknown as CompanionTestWindow).__companionFinals.length
        ),
      { timeout: 20_000, message: 'second final (seg2) never arrived' }
    )
    .toBe(2)

  await expect
    .poll(
      () =>
        companionPage.evaluate(
          () =>
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: companion renderer stamps __companionUtterances on window itself, set above.
            (window as unknown as CompanionTestWindow).__companionUtterances.length
        ),
      { timeout: 20_000, message: 'the combined utterance never reached reportUtterance' }
    )
    .toBe(1)

  const [finals, utterances] = await companionPage.evaluate(() => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: companion renderer stamps these fields on window itself, set above.
    const testWindow = window as unknown as CompanionTestWindow
    return [testWindow.__companionFinals, testWindow.__companionUtterances] as const
  })

  expect(finals).toHaveLength(2)
  expect(utterances).toHaveLength(1)
  const combined = utterances[0]!
  expect(combined).toContain(finals[0]!.trim())
  expect(combined).toContain(finals[1]!.trim())

  await orcaPage.evaluate(() => window.api.companion.toggle())
})

test('companion settings show a localized speed value and the end-of-utterance seconds control', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)

  await orcaPage.evaluate(async (defaultCompanion) => {
    const current = await window.api.settings.get()
    const companion = current.companion ?? defaultCompanion
    const settings = await window.api.settings.set({
      companion: {
        ...companion,
        endOfUtteranceSeconds: 2.5,
        tts: { ...companion.tts, ttsRate: 1.15 }
      }
    })
    window.__store?.setState({ settings })
  }, getDefaultCompanionSettings())

  await orcaPage.evaluate(() => {
    window.__store!.getState().openSettingsPage()
  })
  await expect(orcaPage.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
  await dismissTransientAnnouncement(orcaPage)
  // Why search instead of openSettingsTarget: the companion controls live in a
  // `SettingsSection id="companion"` on the single desktop-capabilities settings page,
  // not behind a distinct navigable pane — searching surfaces that whole section (same
  // pattern as settings-agent-awake.spec.ts).
  await orcaPage.getByPlaceholder('Search settings').fill('jarvis')

  const endOfUtteranceLabel = orcaPage.getByText('Пауза перед завершением фразы')
  // Why a regex, not a fixed string: the decimal separator is locale-dependent
  // (Intl.NumberFormat renders "1,15×" for ru, "1.15×" for en) — the fix under test is
  // that this value is localized at all, not which locale happens to be active.
  const ttsRateValue = orcaPage.getByText(/^1[.,]15×$/)
  await expect(endOfUtteranceLabel).toBeVisible({ timeout: 10_000 })
  await ttsRateValue.scrollIntoViewIfNeeded()
  await expect(ttsRateValue).toBeVisible({ timeout: 10_000 })

  const endBox = await endOfUtteranceLabel.boundingBox()
  const rateBox = await ttsRateValue.boundingBox()
  if (!endBox || !rateBox) {
    throw new Error('could not measure the companion settings rows to screenshot')
  }
  const padding = 16
  const left = Math.min(endBox.x, rateBox.x)
  const top = Math.max(0, endBox.y - padding)
  const right = Math.max(endBox.x + endBox.width, rateBox.x + rateBox.width)
  const bottom = rateBox.y + rateBox.height + padding
  await orcaPage.screenshot({
    path: `${SCREENSHOT_DIR}/companion-settings-speed-and-end-of-utterance.png`,
    clip: {
      x: Math.max(0, left - padding),
      y: top,
      width: right - left + padding * 2,
      height: bottom - top
    }
  })
})
