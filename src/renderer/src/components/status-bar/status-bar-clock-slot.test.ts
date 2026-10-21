import { describe, expect, it } from 'vitest'
import { computeClockSlotWidth } from './status-bar-density'

// The clock is centred on the bar, so its slot must clear the wider side on both halves.
describe('computeClockSlotWidth', () => {
  it('keeps a centred clock clear of a usage cluster wider than the right segments', () => {
    const availableWidth = 1600
    const usageRenderedWidth = 600
    const slot = computeClockSlotWidth({ availableWidth, usageRenderedWidth, segmentsWidth: 300 })
    expect(availableWidth / 2 - slot / 2).toBeGreaterThan(usageRenderedWidth)
  })

  it('keeps a centred clock clear of right segments wider than the usage cluster', () => {
    const availableWidth = 1600
    const segmentsWidth = 600
    const slot = computeClockSlotWidth({ availableWidth, usageRenderedWidth: 300, segmentsWidth })
    expect(availableWidth / 2 + slot / 2).toBeLessThan(availableWidth - segmentsWidth)
  })

  it('hides the clock once the wider side reaches the bar centre', () => {
    expect(
      computeClockSlotWidth({ availableWidth: 1000, usageRenderedWidth: 480, segmentsWidth: 100 })
    ).toBe(0)
  })
})
