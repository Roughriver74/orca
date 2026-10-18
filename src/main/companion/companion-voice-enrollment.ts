// Stores the "Голос владельца" enrollment profile: up to 3 short-phrase speaker
// embeddings recorded in Settings, averaged at verify time into one reference vector for
// companion-voice-focus.ts. Lives directly under userData (not the synced settings
// profile) — embeddings are not secrets, but they are per-machine biometric data with no
// reason to leave the machine, so they get their own plain JSON file rather than riding
// along in GlobalSettings.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import type { CompanionVoiceEnrollmentStatus } from '../../shared/companion-types'

const VOICE_ENROLLMENT_FILE = 'voice-profile.json'
const MAX_ENROLLED_PHRASES = 3

export type VoiceEnrollmentProfile = {
  /** Up to MAX_ENROLLED_PHRASES embeddings, one per recorded phrase. */
  phraseEmbeddings: number[][]
  updatedAt: number
}

export function getVoiceEnrollmentFilePath(userDataDir: string): string {
  return join(userDataDir, VOICE_ENROLLMENT_FILE)
}

function isVoiceEnrollmentProfile(value: unknown): value is VoiceEnrollmentProfile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as { phraseEmbeddings?: unknown; updatedAt?: unknown }
  return (
    Array.isArray(candidate.phraseEmbeddings) &&
    candidate.phraseEmbeddings.every(
      (embedding) => Array.isArray(embedding) && embedding.every((v) => typeof v === 'number')
    ) &&
    typeof candidate.updatedAt === 'number'
  )
}

export function loadVoiceEnrollmentProfile(userDataDir: string): VoiceEnrollmentProfile | null {
  const filePath = getVoiceEnrollmentFilePath(userDataDir)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
    return isVoiceEnrollmentProfile(parsed) ? parsed : null
  } catch {
    return null
  }
}

function saveVoiceEnrollmentProfile(userDataDir: string, profile: VoiceEnrollmentProfile): void {
  writeFileAtomically(
    getVoiceEnrollmentFilePath(userDataDir),
    `${JSON.stringify(profile, null, 2)}\n`
  )
}

/** Appends one phrase embedding (up to MAX_ENROLLED_PHRASES total); the caller is
 *  responsible for calling clearVoiceEnrollment() first when starting a fresh re-record —
 *  this never silently drops an older phrase to make room, so a partial re-record cannot
 *  corrupt a working profile. */
export function addVoiceEnrollmentPhrase(
  userDataDir: string,
  embedding: number[] | Float32Array
): VoiceEnrollmentProfile {
  const existing = loadVoiceEnrollmentProfile(userDataDir)
  const phraseEmbeddings = existing?.phraseEmbeddings ? [...existing.phraseEmbeddings] : []
  if (phraseEmbeddings.length >= MAX_ENROLLED_PHRASES) {
    throw new Error(`Voice enrollment already has ${MAX_ENROLLED_PHRASES} phrases; clear it first`)
  }
  phraseEmbeddings.push(Array.from(embedding))
  const profile: VoiceEnrollmentProfile = { phraseEmbeddings, updatedAt: Date.now() }
  saveVoiceEnrollmentProfile(userDataDir, profile)
  return profile
}

export function clearVoiceEnrollment(userDataDir: string): void {
  saveVoiceEnrollmentProfile(userDataDir, { phraseEmbeddings: [], updatedAt: Date.now() })
}

export function getVoiceEnrollmentStatus(userDataDir: string): CompanionVoiceEnrollmentStatus {
  const profile = loadVoiceEnrollmentProfile(userDataDir)
  const phraseCount = profile?.phraseEmbeddings.length ?? 0
  return {
    enrolled: phraseCount > 0,
    phraseCount,
    updatedAt: phraseCount > 0 ? (profile?.updatedAt ?? null) : null
  }
}

/** Element-wise mean of the enrolled phrase embeddings — the single reference vector
 *  companion-voice-focus.ts compares each new segment's embedding against. */
export function meanEmbedding(profile: VoiceEnrollmentProfile): number[] {
  const { phraseEmbeddings } = profile
  if (phraseEmbeddings.length === 0) {
    return []
  }
  const dim = phraseEmbeddings[0]!.length
  const mean = Array.from<number>({ length: dim }).fill(0)
  for (const embedding of phraseEmbeddings) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] += (embedding[i] ?? 0) / phraseEmbeddings.length
    }
  }
  return mean
}

export const MAX_VOICE_ENROLLMENT_PHRASES = MAX_ENROLLED_PHRASES
