// Third-party summary pricing — Yandex's own price page sits behind a captcha, so these
// are approximate and labeled as such everywhere they reach the UI. Named constants so a
// price update is a one-line change, not a search-and-replace through cost math.

/** v1 `tts:synthesize`: ~1342 ₽ per 1,000,000 characters, billed per character. */
export const YANDEX_V1_RUB_PER_CHAR = 1342 / 1_000_000

/** v3 `utteranceSynthesis`: ~0.1626 ₽ per request unit of up to 250 characters. */
export const YANDEX_V3_RUB_PER_UNIT = 0.1626
export const YANDEX_V3_UNIT_MAX_CHARS = 250

export const YANDEX_PRICING_IS_APPROXIMATE = true

export function yandexV1CostRub(characters: number): number {
  return characters * YANDEX_V1_RUB_PER_CHAR
}

export function yandexV3UnitsForChars(characters: number): number {
  return Math.max(1, Math.ceil(characters / YANDEX_V3_UNIT_MAX_CHARS))
}

export function yandexV3CostRub(characters: number): number {
  return yandexV3UnitsForChars(characters) * YANDEX_V3_RUB_PER_UNIT
}
