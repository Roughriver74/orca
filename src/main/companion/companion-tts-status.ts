import { sendToTrustedUIRenderer } from '../ipc/ui'
import type { CompanionTtsProvisioningStatus } from '../../shared/companion-types'

/**
 * Called directly (same process, no IPC needed) by the TTS provisioner whenever
 * its download/load state changes. Forwarded to the main window's trusted UI
 * renderer over `companion:ttsProvisioningStatus`, where the Companion settings
 * pane renders the idle/downloading/ready/error row.
 */
export function reportTtsProvisioningStatus(status: CompanionTtsProvisioningStatus): void {
  sendToTrustedUIRenderer('companion:ttsProvisioningStatus', status)
}
