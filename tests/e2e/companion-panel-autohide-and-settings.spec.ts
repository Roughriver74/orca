// Backlog #28 coverage not already exercised by companion-wake-background-listening.spec.ts
// (wake-mode panel-stays-hidden + pill) or companion-hotkey-fullscreen-overlay.spec.ts (hotkey
// panel mechanics): an explicit request (hotkey-equivalent `companion:toggle`, the same IPC
// entry point the real global hotkey calls) still shows the big panel, and it auto-hides itself
// ~6s after a reply finishes playing (`companion-panel-visibility.ts`/`companion-panel-auto-
// hide.ts`), using the real `companion:audio-state` "ended" signal rather than a full TTS
// pipeline. Also screenshots the two new settings rows this backlog added to the Companion pane.
import { mkdirSync } from 'node:fs'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'
import { dismissTransientAnnouncement } from './helpers/ssh-config-host-picker'
import { getDefaultCompanionSettings } from '../../src/shared/constants'
import { COMPANION_PANEL_AUTO_HIDE_DELAY_MS } from '../../src/main/companion/companion-panel-auto-hide'

const SCREENSHOT_DIR = '/Users/evgenijsikunov/assistant/voice-lab/indicator'
mkdirSync(SCREENSHOT_DIR, { recursive: true })

test('an explicit request shows the big panel; it auto-hides itself after the reply finishes playing @headful', async ({
  electronApp,
  orcaPage
}) => {
  test.setTimeout(60_000)
  await waitForSessionReady(orcaPage)

  // Default settings: `autoHidePanelAfterReply` on, `showPanelOnAddress` off (irrelevant here —
  // this is the explicit-request path, not wake mode).
  await orcaPage.evaluate(async (defaultCompanion) => {
    const current = await window.api.settings.get()
    const companion = current.companion ?? defaultCompanion
    const settings = await window.api.settings.set({ companion: { ...companion, enabled: true } })
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
  const companionWindow = () =>
    electronApp.evaluate(({ BrowserWindow }, url) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL() === url)
      return win?.isVisible() ?? null
    }, companionUrl)

  expect(await companionWindow()).toBe(false)

  // The real entry point the global hotkey calls (see companion-shortcut.ts's
  // `toggleCompanionConversation` -> `companion:toggle`): idle -> start + showCompanionPanel().
  await orcaPage.evaluate(() => window.api.companion.toggle())
  await expect.poll(companionWindow, { timeout: 10_000 }).toBe(true)
  await expect(companionPage.getByText('Слушаю…')).toBeVisible({ timeout: 10_000 })
  await companionPage.screenshot({ path: `${SCREENSHOT_DIR}/companion-panel-shown-explicit.png` })

  // Simulate "a reply just finished playing" without a real TTS pipeline — the same
  // `companion:audio-state` IPC the panel's own playback code reports on real "ended".
  await companionPage.evaluate(() =>
    window.api.companion.reportAudioState({ utteranceId: 'e2e-autohide', state: 'ended' })
  )

  // Still visible just before the delay elapses — proves this is the timer firing, not an
  // immediate hide.
  await companionPage.waitForTimeout(COMPANION_PANEL_AUTO_HIDE_DELAY_MS - 1_500)
  expect(await companionWindow()).toBe(true)

  await expect
    .poll(companionWindow, {
      timeout: 5_000,
      message: 'the panel never auto-hid after the configured delay'
    })
    .toBe(false)

  // Close the conversation so no mic/STT stays active for the rest of the suite.
  await orcaPage.evaluate(() => window.api.companion.toggle())
})

test('companion settings show the show-panel-on-address and auto-hide-after-reply rows', async ({
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)

  await orcaPage.evaluate(() => {
    window.__store!.getState().openSettingsPage()
  })
  await expect(orcaPage.getByPlaceholder('Search settings')).toBeVisible({ timeout: 10_000 })
  await dismissTransientAnnouncement(orcaPage)
  await orcaPage.getByPlaceholder('Search settings').fill('jarvis')

  const showOnAddressLabel = orcaPage.getByText('Показывать панель при обращении')
  const autoHideLabel = orcaPage.getByText('Прятать панель после ответа')
  await expect(showOnAddressLabel).toBeVisible({ timeout: 10_000 })
  await autoHideLabel.scrollIntoViewIfNeeded()
  await expect(autoHideLabel).toBeVisible({ timeout: 10_000 })

  const topBox = await showOnAddressLabel.boundingBox()
  const bottomBox = await autoHideLabel.boundingBox()
  if (!topBox || !bottomBox) {
    throw new Error('could not measure the companion settings rows to screenshot')
  }
  const padding = 16
  await orcaPage.screenshot({
    path: `${SCREENSHOT_DIR}/companion-settings-panel-visibility-rows.png`,
    clip: {
      x: Math.max(0, Math.min(topBox.x, bottomBox.x) - padding),
      y: Math.max(0, topBox.y - padding),
      width:
        Math.max(topBox.x + topBox.width, bottomBox.x + bottomBox.width) - topBox.x + padding * 2,
      height: bottomBox.y + bottomBox.height - topBox.y + padding * 2
    }
  })
})
