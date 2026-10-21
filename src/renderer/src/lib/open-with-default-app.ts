import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { showLocalPathOpenBlockedToast } from './local-path-open-guard'
import { LOCAL_EXECUTION_HOST_ID } from '../../../shared/execution-host'

/**
 * Opens a client-local path in the OS default app, and reports why when it cannot. `blocked`
 * must come from `isLocalPathOpenBlocked` — `shell:openFilePath` has no SSH/runtime awareness
 * of its own, unlike `shell:openInFileManager`, so callers gate it themselves.
 */
export async function openWithDefaultApp(path: string, blocked: boolean): Promise<void> {
  if (blocked) {
    showLocalPathOpenBlockedToast()
    return
  }
  const opened = await window.api.shell.openFilePath(path, LOCAL_EXECUTION_HOST_ID)
  if (!opened) {
    toast.error(translate('auto.lib.open.with.default.app.failed', 'Could not open the file.'))
  }
}
