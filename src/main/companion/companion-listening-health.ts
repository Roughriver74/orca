// Tracks whether the companion panel's mic capture is actually running. Wake mode's
// background listening never shows the panel, so a failed `speech:startDictation` (mic
// permission revoked, STT model failed to load) would otherwise fail completely
// silently — the user says the wake phrase, nothing happens, and there is no error
// banner anywhere because the panel that would show it is hidden. The panel reports its
// own start/stop outcome here over `companion:reportListeningHealth`; this module just
// holds the latest status and forwards it to the main window's Settings pane.

import { sendToTrustedUIRenderer } from '../ipc/ui'
import type { CompanionListeningStatus } from '../../shared/companion-types'

let status: CompanionListeningStatus = { ok: true, error: null, updatedAt: 0 }

export function getCompanionListeningStatus(): CompanionListeningStatus {
  return status
}

export function reportCompanionListeningHealth(ok: boolean, error: string | null): void {
  status = { ok, error: ok ? null : error, updatedAt: Date.now() }
  sendToTrustedUIRenderer('companion:listeningStatusChanged', status)
}
