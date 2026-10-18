import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString('utf8')),
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  isEncryptionAvailable: vi.fn(() => true)
}))

let tempHome = ''

async function loadStoreModule() {
  vi.resetModules()
  const { setSecretStore } = await import('../../../shared/secret-store')
  setSecretStore({ ...safeStorageMock, describeProtectionGap: () => null })
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof Os>('os')
    return { ...actual, homedir: () => tempHome }
  })
  return import('./companion-tts-yandex-key-store')
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-yandex-key-store-'))
  safeStorageMock.decryptString.mockClear()
  safeStorageMock.encryptString.mockClear()
  safeStorageMock.isEncryptionAvailable.mockClear()
  safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
})

function writeStoredYandexKey(value: string): void {
  const orcaDir = join(tempHome, '.orca')
  mkdirSync(orcaDir, { recursive: true })
  writeFileSync(join(orcaDir, 'yandex-speechkit-token.enc'), value)
}

describe('Yandex SpeechKit API key store', () => {
  it('checks configured status without decrypting', async () => {
    writeStoredYandexKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.hasYandexSpeechKitApiKey()).toBe(true)
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('decrypts only when the key is read for a synthesis request', async () => {
    writeStoredYandexKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readYandexSpeechKitApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('caches the decrypted key across repeated reads', async () => {
    writeStoredYandexKey('encrypted-key')
    const store = await loadStoreModule()

    expect(store.readYandexSpeechKitApiKey()).toBe('encrypted-key')
    expect(store.readYandexSpeechKitApiKey()).toBe('encrypted-key')
    expect(safeStorageMock.decryptString).toHaveBeenCalledOnce()
  })

  it('uses the in-memory key after save without decrypting', async () => {
    const store = await loadStoreModule()

    store.saveYandexSpeechKitApiKey('saved-key')

    expect(store.readYandexSpeechKitApiKey()).toBe('saved-key')
    expect(safeStorageMock.decryptString).not.toHaveBeenCalled()
  })

  it('clears the key from disk and the in-memory cache', async () => {
    writeStoredYandexKey('encrypted-key')
    const store = await loadStoreModule()
    expect(store.hasYandexSpeechKitApiKey()).toBe(true)

    store.clearYandexSpeechKitApiKey()

    expect(store.hasYandexSpeechKitApiKey()).toBe(false)
    expect(() => store.readYandexSpeechKitApiKey()).toThrow(/not configured/)
  })

  it('reports missing status without creating storage files', async () => {
    const store = await loadStoreModule()

    expect(store.hasYandexSpeechKitApiKey()).toBe(false)
    expect(existsSync(join(tempHome, '.orca'))).toBe(false)
  })

  it('rejects an empty key', async () => {
    const store = await loadStoreModule()
    expect(() => store.saveYandexSpeechKitApiKey('   ')).toThrow(/required/)
  })
})
