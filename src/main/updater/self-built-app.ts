import { app } from 'electron'

// Fork-only: builds from build-mac-local.mjs carry a `-local.` version and are updated by
// ~/bin/orca-custom-update, so the official feed must never replace them.
export function isSelfBuiltApp(): boolean {
  return app.getVersion().includes('-local.')
}
