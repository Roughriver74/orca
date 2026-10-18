// Secure storage for the Yandex SpeechKit API key, mirroring
// ../../speech/openai-api-key-store.ts byte for byte: same safeStorage-via-SecretStore
// envelope, same plaintext-with-a-warning degradation when encryption is unavailable, same
// in-memory cache so a hot conversation loop never re-decrypts (and never re-prompts the
// OS keychain) per utterance. Kept as a sibling file rather than a generalized shared
// store because the two keys differ in file name, module boundary (speech/ vs
// companion/tts/) and lifecycle — folding them into one parameterized store would trade a
// few duplicated lines for an abstraction neither caller needs twice.

import { getSecretStore } from '../../../shared/secret-store'
import { readCredentialFileProtection } from '../../credential-file-protection'
import type { SecretAtRestProtection } from '../../../shared/secret-at-rest-protection'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const YANDEX_SPEECHKIT_TOKEN_FILE = 'yandex-speechkit-token.enc'
let cachedYandexSpeechKitApiKey: string | null = null

function getYandexSpeechKitKeyPath(): string {
  return join(homedir(), '.orca', YANDEX_SPEECHKIT_TOKEN_FILE)
}

export function hasYandexSpeechKitApiKey(): boolean {
  // Why: settings calls this on open; checking file existence avoids a decrypt that
  // would trigger a macOS keychain prompt just for opening a settings pane.
  return existsSync(getYandexSpeechKitKeyPath())
}

export function getYandexSpeechKitApiKeyProtection(): SecretAtRestProtection | null {
  return readCredentialFileProtection(getYandexSpeechKitKeyPath())
}

export function saveYandexSpeechKitApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('Yandex SpeechKit API key is required')
  }
  const dir = join(homedir(), '.orca')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const path = getYandexSpeechKitKeyPath()
  if (getSecretStore().isEncryptionAvailable()) {
    writeFileSync(path, getSecretStore().encryptString(trimmed), { mode: 0o600 })
    cachedYandexSpeechKitApiKey = trimmed
    return
  }

  console.warn(
    '[companion-tts] secret encryption unavailable — storing Yandex SpeechKit key in plaintext'
  )
  writeFileSync(path, trimmed, { encoding: 'utf8', mode: 0o600 })
  cachedYandexSpeechKitApiKey = trimmed
}

export function readYandexSpeechKitApiKey(): string {
  if (cachedYandexSpeechKitApiKey !== null) {
    return cachedYandexSpeechKitApiKey
  }
  const path = getYandexSpeechKitKeyPath()
  if (!existsSync(path)) {
    throw new Error('Yandex SpeechKit API key is not configured')
  }
  try {
    const raw = readFileSync(path)
    cachedYandexSpeechKitApiKey = getSecretStore().isEncryptionAvailable()
      ? getSecretStore().decryptString(raw)
      : raw.toString('utf8')
    return cachedYandexSpeechKitApiKey
  } catch {
    throw new Error('Yandex SpeechKit API key could not be decrypted')
  }
}

export function clearYandexSpeechKitApiKey(): void {
  cachedYandexSpeechKitApiKey = null
  rmSync(getYandexSpeechKitKeyPath(), { force: true })
}

/** Test-only: drops the in-memory cache so a test writing the file directly is observed. */
export function _resetYandexSpeechKitApiKeyCacheForTests(): void {
  cachedYandexSpeechKitApiKey = null
}
