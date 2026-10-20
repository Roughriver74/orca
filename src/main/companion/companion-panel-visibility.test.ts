import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultCompanionSettings } from '../../shared/constants'
import type { CompanionSettings } from '../../shared/companion-types'
import { companionConversation } from './companion-conversation'
import { reportAudioState } from './companion-audio-output'

const { hideCompanionPanelMock } = vi.hoisted(() => ({ hideCompanionPanelMock: vi.fn() }))

vi.mock('../window/companion-window', () => ({ hideCompanionPanel: hideCompanionPanelMock }))

import { initCompanionPanelAutoHide } from './companion-panel-visibility'
import { COMPANION_PANEL_AUTO_HIDE_DELAY_MS } from './companion-panel-auto-hide'

function makeStore(overrides: Partial<CompanionSettings> = {}) {
  return { getSettings: () => ({ companion: { ...getDefaultCompanionSettings(), ...overrides } }) }
}

describe('initCompanionPanelAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hideCompanionPanelMock.mockReset()
    companionConversation.stop()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the panel the configured delay after a reply finishes playing, when the setting is on', () => {
    const dispose = initCompanionPanelAutoHide(makeStore({ autoHidePanelAfterReply: true }))
    reportAudioState({ utteranceId: 'u1', state: 'ended' })
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS)
    expect(hideCompanionPanelMock).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('never schedules when the setting is off', () => {
    const dispose = initCompanionPanelAutoHide(makeStore({ autoHidePanelAfterReply: false }))
    reportAudioState({ utteranceId: 'u1', state: 'ended' })
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS * 2)
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
    dispose()
  })

  it('ignores non-"ended" audio states (playing/stopped)', () => {
    const dispose = initCompanionPanelAutoHide(makeStore({ autoHidePanelAfterReply: true }))
    reportAudioState({ utteranceId: 'u1', state: 'playing' })
    reportAudioState({ utteranceId: 'u1', state: 'stopped' })
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS * 2)
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
    dispose()
  })

  it('cancels the pending hide when the user keeps talking', () => {
    const dispose = initCompanionPanelAutoHide(makeStore({ autoHidePanelAfterReply: true }))
    reportAudioState({ utteranceId: 'u1', state: 'ended' })
    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS - 500)

    companionConversation.start()
    companionConversation.reportUtterance('ещё один вопрос')

    vi.advanceTimersByTime(COMPANION_PANEL_AUTO_HIDE_DELAY_MS)
    expect(hideCompanionPanelMock).not.toHaveBeenCalled()
    dispose()
  })
})
