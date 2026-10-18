import { describe, expect, it } from 'vitest'
import {
  YANDEX_V3_UNIT_MAX_CHARS,
  yandexV1CostRub,
  yandexV3CostRub,
  yandexV3UnitsForChars
} from './companion-tts-yandex-pricing'

describe('Yandex pricing', () => {
  it('v1 cost scales linearly with character count', () => {
    expect(yandexV1CostRub(1_000_000)).toBeCloseTo(1342, 5)
    expect(yandexV1CostRub(0)).toBe(0)
  })

  it('v3 units round a partial unit up, never down', () => {
    expect(yandexV3UnitsForChars(1)).toBe(1)
    expect(yandexV3UnitsForChars(YANDEX_V3_UNIT_MAX_CHARS)).toBe(1)
    expect(yandexV3UnitsForChars(YANDEX_V3_UNIT_MAX_CHARS + 1)).toBe(2)
    expect(yandexV3UnitsForChars(YANDEX_V3_UNIT_MAX_CHARS * 2)).toBe(2)
  })

  it('v3 cost is the per-unit price times the unit count', () => {
    expect(yandexV3CostRub(250)).toBeCloseTo(0.1626, 5)
    expect(yandexV3CostRub(251)).toBeCloseTo(0.1626 * 2, 5)
  })
})
