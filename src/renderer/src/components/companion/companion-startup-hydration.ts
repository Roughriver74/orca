import { useEffect, type MutableRefObject } from 'react'
import type { CompanionSettings } from '../../../../shared/companion-types'

/** Hydrates settings + the speech-model catalog once at mount, and resumes listening if a
 *  conversation is already open (panel remount via HMR, or a fresh window mid-session) —
 *  split out of `CompanionPanel` to keep that file under the repo's per-file line cap. */
export function useCompanionStartupHydration(deps: {
  settingsRef: MutableRefObject<CompanionSettings>
  isStreamingModelRef: MutableRefObject<boolean>
  startListening: (resetTranscript: boolean) => Promise<void>
}): void {
  const { settingsRef, isStreamingModelRef, startListening } = deps
  useEffect(() => {
    let disposed = false
    void window.api.companion.getSettings().then((settings) => {
      if (disposed) {
        return
      }
      settingsRef.current = settings
      void window.api.speech.getCatalog().then((catalog) => {
        if (disposed) {
          return
        }
        isStreamingModelRef.current =
          catalog.find((m) => m.id === settings.sttModel)?.streaming ?? false
      })
    })
    void window.api.companion.getConversationState().then((state) => {
      if (!disposed && state !== 'idle') {
        void startListening(false)
      }
    })
    return () => {
      disposed = true
    }
  }, [settingsRef, isStreamingModelRef, startListening])
}
