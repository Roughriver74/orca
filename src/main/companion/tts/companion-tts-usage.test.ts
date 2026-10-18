import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getCompanionTtsUsageSnapshot,
  isYandexTtsBudgetExceeded,
  recordYandexTtsUsage
} from './companion-tts-usage'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-companion-tts-usage-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const DAY_1 = new Date('2026-10-01T12:00:00Z')
const DAY_2 = new Date('2026-10-02T12:00:00Z')
const DAY_31 = new Date('2026-10-31T12:00:00Z')

describe('recordYandexTtsUsage / getCompanionTtsUsageSnapshot', () => {
  it('accumulates characters/cost for a cache miss into today only', () => {
    recordYandexTtsUsage(
      dir,
      { characters: 100, requestUnits: 1, costRub: 0.1626, cacheHit: false, cacheHitSavingsRub: 0 },
      DAY_1
    )

    const snapshot = getCompanionTtsUsageSnapshot(dir, 300, DAY_1)
    expect(snapshot.today.characters).toBe(100)
    expect(snapshot.today.requestUnits).toBe(1)
    expect(snapshot.today.costRub).toBeCloseTo(0.1626, 5)
    expect(snapshot.today.requests).toBe(1)
  })

  it('records a cache hit as savings, not cost', () => {
    recordYandexTtsUsage(
      dir,
      {
        characters: 50,
        requestUnits: 1,
        costRub: 0.1626,
        cacheHit: true,
        cacheHitSavingsRub: 0.1626
      },
      DAY_1
    )

    const snapshot = getCompanionTtsUsageSnapshot(dir, 300, DAY_1)
    expect(snapshot.today.costRub).toBe(0)
    expect(snapshot.today.cacheHitsSaved).toBe(1)
    expect(snapshot.today.cacheHitSavingsRub).toBeCloseTo(0.1626, 5)
  })

  it('rolls over "today" at the calendar day boundary while keeping it in the 30-day total', () => {
    recordYandexTtsUsage(
      dir,
      { characters: 100, requestUnits: 1, costRub: 1, cacheHit: false, cacheHitSavingsRub: 0 },
      DAY_1
    )

    const dayAfter = getCompanionTtsUsageSnapshot(dir, 300, DAY_2)
    expect(dayAfter.today.characters).toBe(0)
    expect(dayAfter.last30Days.characters).toBe(100)

    recordYandexTtsUsage(
      dir,
      { characters: 50, requestUnits: 1, costRub: 2, cacheHit: false, cacheHitSavingsRub: 0 },
      DAY_2
    )
    const afterSecondDay = getCompanionTtsUsageSnapshot(dir, 300, DAY_2)
    expect(afterSecondDay.today.characters).toBe(50)
    expect(afterSecondDay.last30Days.characters).toBe(150)
    expect(afterSecondDay.last30Days.costRub).toBeCloseTo(3, 5)
  })

  it('excludes a day more than 30 days before "now" from the 30-day total', () => {
    recordYandexTtsUsage(
      dir,
      { characters: 999, requestUnits: 1, costRub: 50, cacheHit: false, cacheHitSavingsRub: 0 },
      DAY_1
    )

    const snapshot = getCompanionTtsUsageSnapshot(dir, 300, DAY_31)
    expect(snapshot.last30Days.characters).toBe(0)
  })

  it('flags budgetExceeded once the 30-day cost reaches the budget', () => {
    recordYandexTtsUsage(
      dir,
      { characters: 1000, requestUnits: 10, costRub: 300, cacheHit: false, cacheHitSavingsRub: 0 },
      DAY_1
    )

    expect(isYandexTtsBudgetExceeded(dir, 300, DAY_1)).toBe(true)
    expect(isYandexTtsBudgetExceeded(dir, 301, DAY_1)).toBe(false)
  })

  it('reports budgetExceeded: false with no usage recorded yet', () => {
    const snapshot = getCompanionTtsUsageSnapshot(dir, 300, DAY_1)
    expect(snapshot.budgetExceeded).toBe(false)
    expect(snapshot.today.characters).toBe(0)
  })
})
