import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INTERFACE_THEME_ID,
  INTERFACE_THEMES_DARK,
  INTERFACE_THEMES_LIGHT
} from './interface-themes'

const css = readFileSync(join(__dirname, '../renderer/src/assets/interface-themes.css'), 'utf8')

const HEX_COLOR = /^#[0-9a-f]{6}$/i

describe('interface themes', () => {
  it('has a stylesheet palette for every non-default catalog entry', () => {
    for (const { id } of INTERFACE_THEMES_DARK.filter((t) => t.id !== DEFAULT_INTERFACE_THEME_ID)) {
      expect(css).toContain(`.dark.ui-dark-${id}`)
    }
    for (const { id } of INTERFACE_THEMES_LIGHT.filter(
      (t) => t.id !== DEFAULT_INTERFACE_THEME_ID
    )) {
      expect(css).toContain(`.light.ui-light-${id}`)
    }
  })

  it('has unique ids within each kind', () => {
    const darkIds = INTERFACE_THEMES_DARK.map((t) => t.id)
    const lightIds = INTERFACE_THEMES_LIGHT.map((t) => t.id)
    expect(new Set(darkIds).size).toBe(darkIds.length)
    expect(new Set(lightIds).size).toBe(lightIds.length)
  })

  it('declares a light/dark kind for every entry via catalog membership', () => {
    // Why: id membership in exactly one of the two readonly catalogs IS the
    // theme's light/dark kind (consumed by document-theme / use-document-appearance).
    const darkIds = new Set(INTERFACE_THEMES_DARK.map((t) => t.id))
    const lightIds = new Set(INTERFACE_THEMES_LIGHT.map((t) => t.id))
    for (const id of darkIds) {
      if (id === DEFAULT_INTERFACE_THEME_ID) {
        continue
      }
      expect(lightIds.has(id)).toBe(false)
    }
  })

  it('has a valid swatch hex color for every entry', () => {
    for (const option of [...INTERFACE_THEMES_DARK, ...INTERFACE_THEMES_LIGHT]) {
      expect(option.swatch, `${option.id} swatch`).toMatch(HEX_COLOR)
    }
  })
})
