// Regression coverage for: wake listening ("Слушать всегда, отвечать по обращению") seeded
// enabled BEFORE the app ever launches — matching a real install where the setting is already
// persisted from a previous session, not toggled on mid-session via the hotkey/settings UI like
// companion-dangling-utterance-hold.spec.ts does. The companion panel must never be shown while
// only the wake phrase is pending, and a finalized utterance that names Jarvis must reach the
// brain (routeCompanionUtterance's `addressed` path) even though nobody ever opened the panel.
//
// Root-cause investigation (see the fix commit): with wake mode enabled at launch the companion
// window is created hidden and is never shown by `startBackgroundListening()` itself — only a
// later wake-phrase/notice does `showCompanionPanelForNotice()`. Manual repros (both
// Playwright/CDP-driven and a raw `electron.launch()` with no CDP attached at all) could not
// reproduce the real-world "mic goes silent after ~20s, nothing is ever transcribed" failure the
// user saw via macOS Control Center: `document.visibilityState` stayed `'visible'` the whole run
// in every harness tried, and the real STT pipeline (feedAudio -> real GigaAM/Parakeet decoder ->
// speech:final -> wake gate -> companionConversation.reportUtterance) worked end to end once that
// was true. That is itself informative: the application-level pipeline is not broken when the
// renderer's own visibility signal is healthy, which points at a macOS/Electron window-occlusion-
// driven renderer-backgrounding regression for exactly this `transparent` + `alwaysOnTop` +
// `type: 'panel'` + never-shown window shape (see electron/electron#51718, open as of this
// writing, confirmed on Electron 40.9+ — Orca pins 43.7.5) rather than a bug this test's harness
// (CDP-driven, short-lived) can trigger. The fix landed two mitigations that do not depend on
// reproducing that occlusion state directly — `disable-backgrounding-occluded-windows` /
// `disable-renderer-backgrounding` (configure-process.ts) and a `prevent-app-suspension`
// powerSaveBlocker held for the lifetime of background listening (companion-wake-listening.ts,
// against macOS App Nap) — plus a listening-health status surfaced to Settings
// (companion-listening-health.ts) so a failed background mic start is no longer silent. This spec
// exercises the full wake pipeline end to end with wake mode already enabled at launch and the
// panel genuinely never shown, which IS what the CDP harness can verify; it cannot verify the
// occlusion/App-Nap mitigations themselves (see the module header comment on
// companion-wake-listening.ts and configure-process.ts for what is not verifiable headless).
//
// @headful: the panel's real visibility transition (hidden -> shown via `showInactive()`) is
// asserted on the native `BrowserWindow`, which headless background launches never paint at all
// (see tests/AGENTS.md) — `isVisible()` would stay false even once the app calls `showInactive()`.
// Still background-only: `showInactive()` never steals focus or raises the window over anything.
//
// This test owns its own Electron launch (like persisted-session-production-upgrade.spec.ts):
// the shared `electronApp` fixture always seeds a *no-companion* onboarding profile and only
// patches settings after the renderer boots, which cannot reproduce "wake mode was already on
// when the process started".

import { existsSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@stablyai/playwright-test'
import { forwardElectronProcessLogs, test, expect } from './helpers/orca-app'
import { cleanupE2EDaemons, closeElectronAppForE2E } from './helpers/electron-process-shutdown'
import { getOrcaElectronLaunchArgs } from './helpers/electron-launch-args'
import { retryTransientMainEvaluate } from './helpers/electron-main-evaluate-retry'
import {
  assertElectronResolvedIsolatedHome,
  createElectronHomeIsolation
} from './helpers/electron-home-isolation'
import { getE2ECompletedOnboardingProfile } from './helpers/e2e-completed-onboarding-profile'
import { getDefaultCompanionSettings } from '../../src/shared/constants'

const SPEECH_MODELS_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'orca',
  'speech-models'
)
const WAKE_PHRASE = 'Пятница'

const MODELS = ['parakeet-tdt-0.6b-v3-int8', 'gigaam-v3-e2e-rnnt-ru'] as const

type CompanionTestWindow = {
  __wakeTrace: { finals: string[]; states: string[] }
  __playWakeOnly: () => void
  __playAddressed: () => void
}

/** `say -v Milena` + ffmpeg to 16kHz mono, matching the fixture convention the real STT
 *  pipeline (not a mock) is decoded through elsewhere in this suite. */
function synthesizeWav(text: string, outPath: string): void {
  const aiffPath = outPath.replace(/\.wav$/, '.aiff')
  execSync(`say -v Milena -o ${JSON.stringify(aiffPath)} ${JSON.stringify(text)}`)
  execSync(`ffmpeg -y -i ${JSON.stringify(aiffPath)} -ar 16000 -ac 1 ${JSON.stringify(outPath)}`, {
    stdio: 'ignore'
  })
}

async function launchWithWakeEnabledAtStartup(args: {
  modelId: string
  testInfo: TestInfo
}): Promise<{ app: ElectronApplication; userDataDir: string }> {
  const mainPath = path.join(process.cwd(), 'out', 'main', 'index.js')
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-wake-startup-'))
  mkdirSync(path.join(userDataDir, 'speech-models'), { recursive: true })
  cpSync(
    path.join(SPEECH_MODELS_DIR, args.modelId),
    path.join(userDataDir, 'speech-models', args.modelId),
    { recursive: true }
  )

  // Seeded BEFORE electron.launch(): the real failure this covers only exists when wake mode
  // is already on at process start (initCompanionWakeListening's `wasEnabled` branch), not when
  // a running app toggles it on mid-session.
  const defaultCompanion = getDefaultCompanionSettings()
  const onboarding = getE2ECompletedOnboardingProfile()
  const profile = {
    ...onboarding,
    settings: {
      ...onboarding.settings,
      companion: {
        ...defaultCompanion,
        enabled: true,
        sttModel: args.modelId,
        wake: { ...defaultCompanion.wake, enabled: true, phrases: [WAKE_PHRASE] }
      }
    }
  }
  writeFileSync(path.join(userDataDir, 'orca-data.json'), `${JSON.stringify(profile, null, 2)}\n`)

  const { ELECTRON_RUN_AS_NODE: _unused, ...cleanEnv } = process.env
  void _unused
  const homeIsolation = createElectronHomeIsolation({
    inheritedEnv: cleanEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  const app = await electron.launch({
    args: getOrcaElectronLaunchArgs(mainPath, true),
    env: {
      ...homeIsolation.env,
      NODE_ENV: 'development',
      // Why headful, not the usual ORCA_E2E_HEADLESS: isWindowlessLaunch() suppresses every
      // showInactive() call under headless background launches, so the panel's hidden->shown
      // transition (this spec's whole point) would never actually happen on the native window.
      // Still background-only — see the @headful note in the file header.
      ORCA_E2E_HEADFUL: '1'
    }
  })
  forwardElectronProcessLogs(app, args.testInfo)
  const resolvedHome = await retryTransientMainEvaluate(() =>
    app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
  )
  assertElectronResolvedIsolatedHome(resolvedHome, homeIsolation)
  return { app, userDataDir }
}

async function findCompanionPage(app: ElectronApplication): Promise<Page> {
  await expect
    .poll(
      async () =>
        app.windows().find((candidate) => candidate.url().includes('companion.html')) ?? null,
      { timeout: 30_000 }
    )
    .not.toBeNull()
  const page = app.windows().find((candidate) => candidate.url().includes('companion.html'))
  if (!page) {
    throw new Error('companion window never appeared')
  }
  await page.waitForLoadState('domcontentloaded')
  return page
}

for (const modelId of MODELS) {
  test(`wake mode enabled at launch stays hidden until addressed, then reaches the brain (${modelId}) @headful`, async (// oxlint-disable-next-line no-empty-pattern -- this spec owns its Electron launch.
  {}, testInfo) => {
    test.skip(
      !existsSync(path.join(SPEECH_MODELS_DIR, modelId)),
      `requires a pre-downloaded ${modelId} model at ${SPEECH_MODELS_DIR}`
    )
    test.setTimeout(240_000)

    const wavDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-wake-wav-'))
    const wakeOnlyWav = path.join(wavDir, 'wake-only.wav')
    const addressedWav = path.join(wavDir, 'addressed.wav')
    synthesizeWav(WAKE_PHRASE, wakeOnlyWav)
    synthesizeWav(`${WAKE_PHRASE}, что у меня сегодня?`, addressedWav)
    const wakeOnlyBase64 = readFileSync(wakeOnlyWav).toString('base64')
    const addressedBase64 = readFileSync(addressedWav).toString('base64')

    const { app, userDataDir } = await launchWithWakeEnabledAtStartup({ modelId, testInfo })
    try {
      const companionPage = await findCompanionPage(app)
      companionPage.on('console', (msg) => console.log('[DEBUG companion-console]', msg.text()))
      companionPage.on('pageerror', (err) => console.log('[DEBUG pageerror]', err))
      // The panel must still be genuinely hidden: wake mode's background listening never shows
      // it (see companion-wake-listening.ts's `startBackgroundListening` — only a wake phrase or
      // notice does that), confirming the mic pipeline starts without ever revealing anything.
      expect(
        await (await app.browserWindow(companionPage)).evaluate((window) => window.isVisible())
      ).toBe(false)

      // Why addInitScript + reload, not a plain page.evaluate() here: the panel's
      // useCompanionStartupHydration effect already called getUserMedia() with the real system
      // mic the moment this page's React tree mounted (wake mode auto-starts background
      // listening at app init) — before any Node-side script can run against an
      // already-resolved Page handle. addInitScript only takes effect on the next navigation, so
      // the override is installed first, then the panel is reloaded to pick it up — same pattern
      // as voice-microphone-selection.spec.ts's installFakeMicrophoneDevices.
      await companionPage.addInitScript(
        ({ wakeOnlyBase64, addressedBase64 }) => {
          console.log('[DEBUG init] window.api present', Boolean(window.api))
          function base64ToArrayBuffer(base64: string): ArrayBuffer {
            const binary = atob(base64)
            const bytes = new Uint8Array(binary.length)
            for (let i = 0; i < binary.length; i++) {
              bytes[i] = binary.charCodeAt(i)
            }
            return bytes.buffer
          }

          const ctx = new AudioContext()
          const destStreamPromise = (async () => {
            if (ctx.state === 'suspended') {
              await ctx.resume()
            }
            const wakeOnlyBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(wakeOnlyBase64))
            const addressedBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(addressedBase64))
            const dest = ctx.createMediaStreamDestination()

            function play(buffer: AudioBuffer): void {
              // Why resume here too: a long idle wait before the first utterance (this spec's
              // "simulated idle" step) can let Chromium's autoplay policy suspend an
              // AudioContext that was only resumed once at creation — a suspended context's
              // BufferSource.start() silently produces no samples.
              void ctx.resume()
              console.log('[DEBUG init] play() called, ctx.state=', ctx.state)
              const source = ctx.createBufferSource()
              source.buffer = buffer
              source.connect(dest)
              source.start()
            }

            const testWindow = window as unknown as CompanionTestWindow
            testWindow.__playWakeOnly = () => play(wakeOnlyBuffer)
            testWindow.__playAddressed = () => play(addressedBuffer)
            console.log('[DEBUG init] fake mic buffers ready')
            return dest.stream
          })()

          navigator.mediaDevices.getUserMedia = ((constraints: MediaStreamConstraints) => {
            console.log('[DEBUG init] getUserMedia called', JSON.stringify(constraints))
            return destStreamPromise
          }) as typeof navigator.mediaDevices.getUserMedia
        },
        { wakeOnlyBase64, addressedBase64 }
      )
      await companionPage.reload({ waitUntil: 'domcontentloaded' })
      // Why re-acquired, not reused: reload() tears down the page's execution context, which
      // invalidates the prior BrowserWindow JSHandle ("Object has been destroyed").
      const companionWindow = await app.browserWindow(companionPage)

      // Reload tore down the renderer; the panel reveals nothing on its own either way.
      expect(await companionWindow.evaluate((window) => window.isVisible())).toBe(false)

      await companionPage.evaluate(() => {
        const testWindow = window as unknown as CompanionTestWindow
        testWindow.__wakeTrace = { finals: [], states: [] }
        console.log('[DEBUG] post-reload document.readyState', document.readyState)
        console.log('[DEBUG] post-reload window.api present', Boolean(window.api))
        window.api.companion.getConversationState().then((state) => {
          console.log('[DEBUG] getConversationState()', state)
        })
        window.api.speech.onFinalTranscript((data) => {
          console.log('[DEBUG] onFinalTranscript', JSON.stringify(data))
          if (data.sessionId === 'companion') {
            testWindow.__wakeTrace.finals.push(data.text)
          }
        })
        window.api.speech.onPartialTranscript((data) => {
          console.log('[DEBUG] onPartialTranscript', JSON.stringify(data))
        })
        window.api.companion.onStateChanged((state) => {
          console.log('[DEBUG] onStateChanged', state)
          testWindow.__wakeTrace.states.push(state)
        })
        window.api.companion.onListeningStatusChanged((status) => {
          console.log('[DEBUG] onListeningStatusChanged', JSON.stringify(status))
        })
        void window.api.companion.getListeningStatus().then((status) => {
          console.log('[DEBUG] getListeningStatus()', JSON.stringify(status))
        })
      })

      // Practical approximation of "the app has been idle/hidden for a while" before the first
      // utterance — not a real reproduction of minutes-scale macOS App Nap (not practical in an
      // automated run); see the file header for what this spec can and cannot verify.
      await companionPage.waitForTimeout(15_000)

      await expect
        .poll(
          () =>
            companionPage.evaluate(
              () => typeof (window as unknown as CompanionTestWindow).__playWakeOnly === 'function'
            ),
          { timeout: 15_000, message: 'fake mic buffers never finished decoding' }
        )
        .toBe(true)

      // Bare wake phrase: shows the panel (showCompanionPanelForNotice), but must NOT reach the
      // brain — wake-only waits for the request in the follow-up window instead.
      await companionPage.evaluate(() =>
        (window as unknown as CompanionTestWindow).__playWakeOnly()
      )
      await expect
        .poll(() => companionWindow.evaluate((window) => window.isVisible()), {
          timeout: 30_000,
          message: 'panel never became visible for the bare wake phrase'
        })
        .toBe(true)
      const statesAfterWakeOnly = await companionPage.evaluate(
        () => (window as unknown as CompanionTestWindow).__wakeTrace.states
      )
      expect(statesAfterWakeOnly).not.toContain('thinking')

      await expect
        .poll(
          () =>
            companionPage.evaluate(
              () => (window as unknown as CompanionTestWindow).__wakeTrace.finals.length
            ),
          { timeout: 20_000, message: 'the bare wake phrase was never finalized by STT' }
        )
        .toBeGreaterThanOrEqual(1)

      // The silence-driven restart (non-streaming models) needs a moment to start the next
      // dictation session before the next utterance's audio can reach it.
      await companionPage.waitForTimeout(1_500)

      // Addressed utterance ("Пятница, что у меня сегодня?"): must reach
      // routeCompanionUtterance's `addressed` path, observable as the dialogue orchestrator's
      // reportThinking() firing before any brain/network call (companion-dialogue.ts).
      await companionPage.evaluate(() =>
        (window as unknown as CompanionTestWindow).__playAddressed()
      )
      await expect
        .poll(
          () =>
            companionPage.evaluate(() =>
              (window as unknown as CompanionTestWindow).__wakeTrace.states.includes('thinking')
            ),
          { timeout: 30_000, message: 'the addressed utterance never reached the brain' }
        )
        .toBe(true)
    } finally {
      await closeElectronAppForE2E(app)
      await cleanupE2EDaemons(userDataDir)
    }
  })
}
