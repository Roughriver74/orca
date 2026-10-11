/** Interface palettes layered over Orca's light/dark tokens; CSS lives in assets/interface-themes.css. */
export type InterfaceThemeOption = {
  id: string
  label: string
  /** Representative accent hex shown as a swatch dot next to the label in the picker. */
  swatch: string
}

export const DEFAULT_INTERFACE_THEME_ID = 'default'

export const INTERFACE_THEMES_DARK: readonly InterfaceThemeOption[] = [
  { id: DEFAULT_INTERFACE_THEME_ID, label: 'Orca', swatch: '#171717' },
  { id: 'catppuccin-frappe', label: 'Catppuccin Frappé', swatch: '#ca9ee6' },
  { id: 'catppuccin-macchiato', label: 'Catppuccin Macchiato', swatch: '#c6a0f6' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', swatch: '#cba6f7' },
  { id: 'tokyo-night', label: 'Tokyo Night', swatch: '#bb9af7' },
  { id: 'dracula', label: 'Dracula', swatch: '#bd93f9' },
  { id: 'nord', label: 'Nord', swatch: '#88c0d0' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', swatch: '#fe8019' },
  { id: 'one-dark', label: 'One Dark', swatch: '#61afef' },
  { id: 'rose-pine', label: 'Rosé Pine', swatch: '#c4a7e7' },
  { id: 'kanagawa', label: 'Kanagawa', swatch: '#957fb8' },
  { id: 'everforest-dark', label: 'Everforest Dark', swatch: '#a7c080' },
  { id: 'solarized-dark', label: 'Solarized Dark', swatch: '#268bd2' },
  { id: 'github-dark', label: 'GitHub Dark', swatch: '#58a6ff' }
]

export const INTERFACE_THEMES_LIGHT: readonly InterfaceThemeOption[] = [
  { id: DEFAULT_INTERFACE_THEME_ID, label: 'Orca', swatch: '#171717' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', swatch: '#8839ef' },
  { id: 'solarized-light', label: 'Solarized Light', swatch: '#268bd2' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', swatch: '#af3a03' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', swatch: '#907aa9' },
  { id: 'github-light', label: 'GitHub Light', swatch: '#0969da' },
  { id: 'everforest-light', label: 'Everforest Light', swatch: '#8da101' }
]
