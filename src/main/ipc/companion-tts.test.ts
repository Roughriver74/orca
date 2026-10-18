import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanionSettings } from '../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../shared/constants'
import { isRecord } from '../../shared/agent-status-child-work-value-guards'

type Handler = (...args: unknown[]) => unknown

const {
  handleMock,
  removeHandlerMock,
  hasKeyMock,
  getProtectionMock,
  saveKeyMock,
  clearKeyMock,
  readKeyMock,
  synthesizeMock,
  getUsageSnapshotMock
} = vi.hoisted(() => ({
  handleMock: vi.fn<(channel: string, listener: Handler) => void>(),
  removeHandlerMock: vi.fn(),
  hasKeyMock: vi.fn(() => true),
  getProtectionMock: vi.fn(() => 'sealed' as const),
  saveKeyMock: vi.fn(),
  clearKeyMock: vi.fn(),
  readKeyMock: vi.fn(() => 'test-key'),
  synthesizeMock: vi.fn(async () => ({ sampleRate: 48_000, pcm: new Float32Array(1) })),
  getUsageSnapshotMock: vi.fn(() => ({
    today: {
      characters: 0,
      requestUnits: 0,
      requests: 0,
      costRub: 0,
      cacheHitsSaved: 0,
      cacheHitSavingsRub: 0
    },
    last30Days: {
      characters: 0,
      requestUnits: 0,
      requests: 0,
      costRub: 0,
      cacheHitsSaved: 0,
      cacheHitSavingsRub: 0
    },
    budgetRub: 300,
    budgetExceeded: false
  }))
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))

vi.mock('../companion/tts/companion-tts-yandex-key-store', () => ({
  hasYandexSpeechKitApiKey: hasKeyMock,
  getYandexSpeechKitApiKeyProtection: getProtectionMock,
  saveYandexSpeechKitApiKey: saveKeyMock,
  clearYandexSpeechKitApiKey: clearKeyMock,
  readYandexSpeechKitApiKey: readKeyMock
}))

vi.mock('../companion/tts/companion-tts-yandex-provider', () => ({
  CompanionTtsYandexProvider: vi.fn().mockImplementation(function CompanionTtsYandexProvider() {
    return { synthesize: synthesizeMock }
  })
}))

vi.mock('../companion/tts/companion-tts-usage', () => ({
  getCompanionTtsUsageSnapshot: getUsageSnapshotMock
}))

import { registerCompanionTtsHandlers } from './companion-tts'
import { CompanionTtsYandexError } from '../companion/tts/companion-tts-yandex-errors'

function makeStore(companion = getDefaultCompanionSettings()): {
  getSettings: () => { companion: CompanionSettings }
} {
  return { getSettings: () => ({ companion }) }
}

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find(([registered]) => registered === channel)
  if (!call) {
    throw new Error(`no handler registered for ${channel}`)
  }
  return call[1]
}

beforeEach(() => {
  handleMock.mockClear()
  removeHandlerMock.mockClear()
  hasKeyMock.mockClear().mockReturnValue(true)
  saveKeyMock.mockClear()
  clearKeyMock.mockClear()
  synthesizeMock.mockClear().mockResolvedValue({ sampleRate: 48_000, pcm: new Float32Array(1) })
  getUsageSnapshotMock.mockClear()
})

describe('registerCompanionTtsHandlers', () => {
  it('reports key status', async () => {
    registerCompanionTtsHandlers(makeStore())
    const result = await getHandler('companion:getYandexKeyStatus')({})
    expect(result).toEqual({ configured: true, protection: 'sealed' })
  })

  it('saves a trimmed key and rejects a non-string payload', async () => {
    registerCompanionTtsHandlers(makeStore())
    await getHandler('companion:saveYandexApiKey')({}, 'AQVN-test')
    expect(saveKeyMock).toHaveBeenCalledWith('AQVN-test')

    expect(() => getHandler('companion:saveYandexApiKey')({}, 42)).toThrow(/string/)
  })

  it('clears the key', async () => {
    registerCompanionTtsHandlers(makeStore())
    await getHandler('companion:clearYandexApiKey')({})
    expect(clearKeyMock).toHaveBeenCalledOnce()
  })

  it('testYandexApiKey reports ok on a successful synthesis', async () => {
    registerCompanionTtsHandlers(makeStore())
    const result = await getHandler('companion:testYandexApiKey')({})
    expect(result).toEqual({ ok: true })
  })

  it('testYandexApiKey reports a Russian message on failure', async () => {
    synthesizeMock.mockRejectedValueOnce(new CompanionTtsYandexError('auth', 'bad key'))
    registerCompanionTtsHandlers(makeStore())

    const result = await getHandler('companion:testYandexApiKey')({})
    if (!isRecord(result)) {
      throw new Error('unexpected result shape')
    }

    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/[а-яё]/i)
  })

  it('returns the usage snapshot using the configured monthly budget', async () => {
    const companion = {
      ...getDefaultCompanionSettings(),
      tts: { ...getDefaultCompanionSettings().tts, yandexMonthlyBudgetRub: 123 }
    }
    registerCompanionTtsHandlers(makeStore(companion))

    await getHandler('companion:getTtsUsage')({})

    expect(getUsageSnapshotMock).toHaveBeenCalledWith(expect.any(String), 123)
  })
})
