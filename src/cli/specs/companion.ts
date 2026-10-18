import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const COMPANION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['companion', 'ask'],
    summary: 'Ask the Джарвис companion brain — one persistent Claude conversation in ~/assistant',
    usage: 'orca companion ask --text <text> [--reset] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text', 'reset'],
    notes: [
      "Runs headless in the companion's home dir (defaults to ~/assistant), honoring its CLAUDE.md, .claude/settings.json permissions, skills and memory.",
      'Replies continue the same conversation across calls; pass --reset to drop it and start fresh before asking.'
    ],
    examples: [
      'orca companion ask --text "Что сейчас делают мои агенты?"',
      'orca companion ask --text "Начнём заново" --reset'
    ]
  },
  {
    path: ['companion', 'say'],
    summary: "Speak text through the Джарвис companion's TTS voice",
    usage: 'orca companion say --text <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'text'],
    notes: [
      'Uses the voice and rate configured in companion settings (Silero, local, Russian).',
      'TTS must be provisioned first — enable the companion in settings and wait for provisioning to finish.'
    ],
    examples: ['orca companion say --text "Привет! Проверка связи."']
  },
  {
    path: ['companion', 'status'],
    summary:
      'Show the Джарвис companion status: on/off, conversation state, hotkey, last turn, TTS readiness',
    usage: 'orca companion status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca companion status --json']
  },
  {
    path: ['companion', 'toggle'],
    summary: 'Toggle the Джарвис companion conversation — same action as the global hotkey',
    usage: 'orca companion toggle [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Opens a fresh conversation when idle, closes it when listening/thinking, or barges in while it is speaking.',
      'Fails if the companion is disabled in settings.'
    ],
    examples: ['orca companion toggle --json']
  }
]
