// Per-day Yandex usage counters, persisted as one small JSON file under userData — not a
// database: at most ~60 day entries ever accumulate (older ones are pruned on write), each
// a handful of numbers. Day boundaries use the local calendar day (`toLocaleDateString`'s
// sv-SE locale gives a stable `YYYY-MM-DD` without pulling in a date library) so "today" in
// the usage panel matches the day the person is actually having.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { isRecord } from '../../../shared/agent-status-child-work-value-guards'
import type {
  CompanionTtsUsagePeriod,
  CompanionTtsUsageSnapshot
} from '../../../shared/companion-types'

const USAGE_FILE_NAME = 'companion-tts-yandex-usage.json'
const RETAINED_DAYS = 60
const SNAPSHOT_WINDOW_DAYS = 30

type DayCounters = {
  characters: number
  requestUnits: number
  requests: number
  costRub: number
  cacheHits: number
  cacheHitSavingsRub: number
}

type UsageFile = { byDay: Record<string, DayCounters> }

function emptyDay(): DayCounters {
  return {
    characters: 0,
    requestUnits: 0,
    requests: 0,
    costRub: 0,
    cacheHits: 0,
    cacheHitSavingsRub: 0
  }
}

function usagePath(userDataDir: string): string {
  return join(userDataDir, USAGE_FILE_NAME)
}

function dayKey(date: Date): string {
  // sv-SE formats as YYYY-MM-DD, which happens to be the one locale ICU formats that way.
  return date.toLocaleDateString('sv-SE')
}

/** A type predicate, not a deep field validator — matches how a type-flipped persisted
 *  file already degraded before this guard existed (a day missing a numeric field just
 *  reads back `NaN` on the next `+=`, same as any other malformed-but-object-shaped JSON). */
function isUsageByDay(value: unknown): value is UsageFile {
  return isRecord(value) && isRecord(value.byDay)
}

function readUsageFile(userDataDir: string): UsageFile {
  const path = usagePath(userDataDir)
  if (!existsSync(path)) {
    return { byDay: {} }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return { byDay: isUsageByDay(parsed) ? parsed.byDay : {} }
  } catch {
    return { byDay: {} }
  }
}

function writeUsageFile(userDataDir: string, file: UsageFile): void {
  if (!existsSync(userDataDir)) {
    mkdirSync(userDataDir, { recursive: true })
  }
  writeFileSync(usagePath(userDataDir), JSON.stringify(file), { encoding: 'utf8', mode: 0o600 })
}

/** Drops day entries older than `RETAINED_DAYS` relative to `now` — keeps the file small
 *  forever without a separate cleanup job. */
function pruneOldDays(file: UsageFile, now: Date): void {
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() - RETAINED_DAYS)
  const cutoffKey = dayKey(cutoff)
  for (const key of Object.keys(file.byDay)) {
    if (key < cutoffKey) {
      delete file.byDay[key]
    }
  }
}

export type CompanionTtsUsageEvent = {
  characters: number
  requestUnits: number
  costRub: number
  cacheHit: boolean
  /** Cost this request would have incurred had it not been served from cache; 0 on a miss. */
  cacheHitSavingsRub: number
}

/** Records one synthesis (or cache hit) against today's counters. */
export function recordYandexTtsUsage(
  userDataDir: string,
  event: CompanionTtsUsageEvent,
  now: Date = new Date()
): void {
  const file = readUsageFile(userDataDir)
  const key = dayKey(now)
  const day = file.byDay[key] ?? emptyDay()
  day.requests += 1
  day.characters += event.characters
  if (event.cacheHit) {
    day.cacheHits += 1
    day.cacheHitSavingsRub += event.cacheHitSavingsRub
  } else {
    day.requestUnits += event.requestUnits
    day.costRub += event.costRub
  }
  file.byDay[key] = day
  pruneOldDays(file, now)
  writeUsageFile(userDataDir, file)
}

function sumPeriod(file: UsageFile, keys: string[]): CompanionTtsUsagePeriod {
  const totals = emptyDay()
  for (const key of keys) {
    const day = file.byDay[key]
    if (!day) {
      continue
    }
    totals.characters += day.characters
    totals.requestUnits += day.requestUnits
    totals.requests += day.requests
    totals.costRub += day.costRub
    totals.cacheHits += day.cacheHits
    totals.cacheHitSavingsRub += day.cacheHitSavingsRub
  }
  return {
    characters: totals.characters,
    requestUnits: totals.requestUnits,
    requests: totals.requests,
    costRub: totals.costRub,
    cacheHitsSaved: totals.cacheHits,
    cacheHitSavingsRub: totals.cacheHitSavingsRub
  }
}

function last30DayKeys(now: Date): string[] {
  const keys: string[] = []
  for (let offset = 0; offset < SNAPSHOT_WINDOW_DAYS; offset++) {
    const date = new Date(now)
    date.setDate(date.getDate() - offset)
    keys.push(dayKey(date))
  }
  return keys
}

export function getCompanionTtsUsageSnapshot(
  userDataDir: string,
  budgetRub: number,
  now: Date = new Date()
): CompanionTtsUsageSnapshot {
  const file = readUsageFile(userDataDir)
  const last30Days = sumPeriod(file, last30DayKeys(now))
  return {
    today: sumPeriod(file, [dayKey(now)]),
    last30Days,
    budgetRub,
    budgetExceeded: last30Days.costRub >= budgetRub
  }
}

/** Cheap budget gate the TTS service checks before choosing Yandex over Silero for a
 *  turn — a thin read of the same 30-day total the snapshot reports. */
export function isYandexTtsBudgetExceeded(
  userDataDir: string,
  budgetRub: number,
  now: Date = new Date()
): boolean {
  return getCompanionTtsUsageSnapshot(userDataDir, budgetRub, now).budgetExceeded
}
