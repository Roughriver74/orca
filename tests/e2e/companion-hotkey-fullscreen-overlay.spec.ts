// Validates the fix for: pressing the companion hotkey while a fullscreen app
// (or Orca's own fullscreen window) has focus must never activate Orca, steal
// key-window status, or switch the macOS Space — only a non-activating NSPanel
// (`type: 'panel'`, `focusable: false`) + `showInactive()` guarantee that; see
// src/main/window/companion-window.ts. Background-only per tests/AGENTS.md: no
// window is revealed to the developer's desktop. The real "does the Space stay
// put while a fullscreen app has focus" behavior still needs human eyes on a
// real display — this spec can only prove the Electron/macOS-level mechanics
// that make it possible (no activateIgnoringOtherApps, no makeKeyAndOrderFront,
// no change to BrowserWindow.getFocusedWindow()).
import { mkdirSync } from 'node:fs'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { getDefaultCompanionSettings } from '../../src/shared/constants'

const SCREENSHOT_DIR = '/Users/evgenijsikunov/assistant/voice-lab/overlay'
mkdirSync(SCREENSHOT_DIR, { recursive: true })

/** `BrowserWindow.id` of whichever window currently holds OS key-window
 *  status, or null — called at each checkpoint to prove the hotkey path
 *  never changes it. */
function getFocusedWindowId(electronApp: ElectronApplication): Promise<number | null> {
  return electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id ?? null)
}

test('companion hotkey never activates Orca, changes key window, or steals focus', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)

  // Why: enabling companion (matching the user's real `Alt+Enter` hotkey
  // setting) is what makes `ensureCompanionWindowAlive()` create the panel.
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
  const companionUrl = companionPage.url()

  // Native-level proof of `type: 'panel'` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`:
  // the collection behavior flag is live on the real window, not just passed to the constructor.
  const isVisibleOnAllWorkspaces = await electronApp.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)
    return win?.isVisibleOnAllWorkspaces() ?? null
  }, companionUrl)
  expect(isVisibleOnAllWorkspaces).toBe(true)

  // Native-level proof of `focusable: false`: calling the real NSWindow's own
  // `focus()` directly (bypassing all of Orca's app code) must not make it key.
  // This exercises `setDisableKeyOrMainWindow` for real, not just the
  // constructor option captured in the companion-window unit test's fake.
  const becameFocusedAfterDirectFocus = await electronApp.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)
    win?.focus()
    return win?.isFocused() ?? null
  }, companionUrl)
  expect(becameFocusedAfterDirectFocus).toBe(false)

  const focusedWindowIdBefore = await getFocusedWindowId(electronApp)

  // The actual hotkey code path: `globalShortcut.register(hotkey, toggleCompanionConversation)`
  // calls exactly this IPC handler (see src/main/ipc/companion.ts:
  // "the only trigger the panel needs besides the global hotkey").
  await orcaPage.evaluate(() => window.api.companion.toggle())

  // `isActive`/`turnState` flip synchronously inside `startListening`, before any
  // mic-permission await — this is reachable without a real STT model/device.
  await expect(companionPage.getByText('Слушаю…')).toBeVisible({ timeout: 10_000 })

  expect(await getFocusedWindowId(electronApp)).toBe(focusedWindowIdBefore)

  await companionPage.screenshot({
    path: `${SCREENSHOT_DIR}/companion-panel-listening-live-state.png`
  })

  // Default GigaAM model (`gigaam-v3-e2e-rnnt-ru`, `streaming: false` in
  // model-catalog.ts) never emits `speech:partial` — only `speech:final` per
  // decoded chunk (stt-worker.ts). A streaming model (e.g. the bundled
  // zipformer/paraformer configs) would; simulate exactly the IPC message
  // `stt-worker.ts` sends for those to prove the renderer's live-partial path
  // itself works end to end.
  await electronApp.evaluate(({ BrowserWindow }, url) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)
    win?.webContents.send('speech:partial', {
      text: 'привет, это живой партиал',
      sessionId: 'companion'
    })
  }, companionUrl)

  await expect(companionPage.getByText('привет, это живой партиал')).toBeVisible({
    timeout: 5_000
  })

  await companionPage.screenshot({
    path: `${SCREENSHOT_DIR}/companion-panel-partial-transcript.png`
  })

  // Close the conversation — stops any in-flight mic capture/STT worker from
  // the real `companion:toggle()` call above.
  await orcaPage.evaluate(() => window.api.companion.toggle())

  expect(await getFocusedWindowId(electronApp)).toBe(focusedWindowIdBefore)
})
