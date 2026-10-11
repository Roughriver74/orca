import {
  keybindingMatchesAction,
  type KeybindingMatchOptions,
  type KeybindingOverrides
} from './keybindings'
import type { WindowShortcutInput } from './window-shortcut-policy'

type WindowShortcutResolveOptions = KeybindingMatchOptions

function platformPrimaryModifier(
  input: Pick<WindowShortcutInput, 'meta' | 'control'>,
  platform: NodeJS.Platform
): boolean {
  return platform === 'darwin' ? Boolean(input.meta) : Boolean(input.control)
}

export function isWindowShortcutModifierChord(
  input: Pick<WindowShortcutInput, 'meta' | 'control' | 'alt'>,
  platform: NodeJS.Platform
): boolean {
  return platformPrimaryModifier(input, platform) && !input.alt
}

export function matchesRecentTabSwitcherChord(
  input: WindowShortcutInput,
  platform: NodeJS.Platform,
  keybindings?: KeybindingOverrides,
  options: WindowShortcutResolveOptions = {}
): boolean {
  const control = Boolean(input.control ?? input.ctrlKey)
  const meta = Boolean(input.meta ?? input.metaKey)
  const alt = Boolean(input.alt ?? input.altKey)
  if (input.code !== 'Tab' || !control || meta || alt) {
    return false
  }
  // Why: the Ctrl+Tab switcher is a held-key interaction where Shift reverses
  // direction. Gate the whole family on the configurable unshifted binding.
  return keybindingMatchesAction(
    'tab.previousRecent',
    {
      key: input.key,
      code: input.code,
      alt,
      meta,
      control,
      shift: false,
      altKey: alt,
      metaKey: meta,
      ctrlKey: control,
      shiftKey: false
    },
    platform,
    keybindings,
    options
  )
}

function isControlKey(input: WindowShortcutInput): boolean {
  return (
    input.code === 'ControlLeft' ||
    input.code === 'ControlRight' ||
    input.code === 'Control' ||
    input.key === 'Control'
  )
}

function isTabKey(input: WindowShortcutInput): boolean {
  return input.code === 'Tab' || input.key === 'Tab'
}

export function isRecentTabSwitcherCommitRelease(input: WindowShortcutInput): boolean {
  if (input.type !== 'keyUp' && input.type !== 'keyup') {
    return false
  }
  if (isControlKey(input)) {
    return true
  }
  const control = input.control ?? input.ctrlKey
  // Why: some Electron surfaces report the final Ctrl+Tab release as Tab
  // keyup after Control is already up, so commit instead of stranding the UI.
  return isTabKey(input) && control === false
}
