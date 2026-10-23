import { app } from 'electron'
import { join } from 'node:path'

// Why the app path, not __dirname: the bundler can hoist these window modules into
// out/main/chunks, one level below out/main, where `../preload` no longer resolves.
export function companionPreloadPath(): string {
  return join(app.getAppPath(), 'out', 'preload', 'index.js')
}

export function companionRendererPage(fileName: string): string {
  return join(app.getAppPath(), 'out', 'renderer', fileName)
}
