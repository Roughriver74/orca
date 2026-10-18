// Backlog #6 smoke check: another agent's hook status transitions to `done` while the
// companion is idle → a non-focus-stealing toast appears in the companion panel window.
// Background-only per tests/AGENTS.md: no window is revealed to the developer's desktop.
import { randomUUID } from 'node:crypto'
import { test, expect } from './helpers/orca-app'
import { emitCodexHookStatus, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePaneHookDescriptor, waitForActiveTerminalManager } from './helpers/terminal'
import { getDefaultCompanionSettings } from '../../src/shared/constants'
import { makePaneKey, parsePaneKey } from '../../src/shared/stable-pane-id'

test('agent completion while idle surfaces a companion toast', async ({
  electronApp,
  orcaPage
}) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const { paneKey, worktreeId } = await waitForActivePaneHookDescriptor(orcaPage)

  await orcaPage.evaluate(async (defaultCompanion) => {
    const current = await window.api.settings.get()
    const companion = current.companion ?? defaultCompanion
    const settings = await window.api.settings.set({
      companion: {
        ...companion,
        enabled: true,
        notify: { ...companion.notify, enabled: true, quietFrom: '00:00', quietTo: '00:00' }
      }
    })
    window.__store?.setState({ settings })
  }, getDefaultCompanionSettings())

  const endpoint = await readHookEndpoint(electronApp)
  // Why a fresh `makePaneKey`, not a string suffix: appending text to a real paneKey
  // corrupts its UUID leaf, so the hook server's `isValidPaneKey` check silently drops
  // the event (no error, no watcher callback — this is exactly what broke this test
  // before). A synthetic "other" pane needs its own well-formed pane key.
  const realTabId = parsePaneKey(paneKey)?.tabId
  if (!realTabId) {
    throw new Error(`active pane key is not structured: ${paneKey}`)
  }
  const otherPaneKey = makePaneKey(realTabId, randomUUID())
  await emitCodexHookStatus(endpoint, {
    paneKey: otherPaneKey,
    worktreeId,
    state: 'working',
    prompt: 'companion agent-watch smoke'
  })
  await emitCodexHookStatus(endpoint, {
    paneKey: otherPaneKey,
    worktreeId,
    state: 'done',
    lastAssistantMessage: 'Есть вопросы — обсудим?'
  })

  // The watcher coalesces for 20s before delivering; give it margin.
  const companionPage = await expect
    .poll(
      async () => {
        const pages = electronApp.windows()
        return pages.find((candidate) => candidate.url().includes('companion.html')) ?? null
      },
      { timeout: 30_000 }
    )
    .not.toBeNull()
    .then(() =>
      electronApp.windows().find((candidate) => candidate.url().includes('companion.html'))
    )
  if (!companionPage) {
    throw new Error('companion panel window did not appear')
  }

  await expect(companionPage.getByText('Есть вопросы — обсудим?')).toBeVisible({ timeout: 30_000 })
  await companionPage.screenshot({
    path: '/Users/evgenijsikunov/assistant/voice-lab/notify/companion-agent-notice-toast.png'
  })
})
