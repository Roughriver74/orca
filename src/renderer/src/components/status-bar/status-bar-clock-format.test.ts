import { describe, expect, it } from 'vitest'
import {
  formatStatusBarClockLabel,
  formatStatusBarClockTooltip,
  getMsUntilNextMinuteBoundary
} from './status-bar-clock-format'

describe('formatStatusBarClockLabel', () => {
  it('formats a 24h locale (ru-RU) with short weekday/month and HH:mm', () => {
    // 2026-10-11 is a Sunday.
    const date = new Date(2026, 9, 11, 20, 36, 0)
    expect(formatStatusBarClockLabel(date, 'ru-RU')).toBe('Вс, 11 окт., 20:36')
  })

  it('formats a 12h locale (en-US) with AM/PM', () => {
    const date = new Date(2026, 9, 11, 20, 36, 0)
    expect(formatStatusBarClockLabel(date, 'en-US')).toBe('Sun, Oct 11 at 8:36 PM')
  })

  it('pads single-digit minutes', () => {
    const date = new Date(2026, 9, 11, 9, 5, 0)
    expect(formatStatusBarClockLabel(date, 'en-US')).toBe('Sun, Oct 11 at 9:05 AM')
  })
})

describe('formatStatusBarClockTooltip', () => {
  it('formats the full long-form date for en-US', () => {
    const date = new Date(2026, 9, 11, 20, 36, 0)
    expect(formatStatusBarClockTooltip(date, 'en-US')).toBe('Sunday, October 11, 2026 at 8:36 PM')
  })

  it('formats the full long-form date for ru-RU', () => {
    const date = new Date(2026, 9, 11, 20, 36, 0)
    expect(formatStatusBarClockTooltip(date, 'ru-RU')).toBe(
      'воскресенье, 11 октября 2026 г. в 20:36'
    )
  })
})

describe('getMsUntilNextMinuteBoundary', () => {
  it('returns the full minute when exactly on the boundary', () => {
    const date = new Date(2026, 9, 11, 20, 36, 0, 0)
    expect(getMsUntilNextMinuteBoundary(date)).toBe(60_000)
  })

  it('returns the remaining time mid-minute', () => {
    const date = new Date(2026, 9, 11, 20, 36, 15, 250)
    expect(getMsUntilNextMinuteBoundary(date)).toBe(60_000 - 15_250)
  })

  it('returns a small remainder just before the boundary', () => {
    const date = new Date(2026, 9, 11, 20, 36, 59, 999)
    expect(getMsUntilNextMinuteBoundary(date)).toBe(1)
  })
})
