import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, RotateCcw, Volume2 } from 'lucide-react'
import { DictationGrapes } from '@/components/dictation/DictationGrapes'
import { useAudioCapture } from '@/hooks/use-audio-capture'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  CompanionAgentNotice,
  CompanionConversationState,
  CompanionSettings
} from '../../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../../shared/constants'
import { useCompanionUtteranceHoldWiring } from './companion-utterance-hold-wiring'
import { useCompanionAssistantReplyStream } from './companion-assistant-reply-stream'
import { useCompanionStartupHydration } from './companion-startup-hydration'
import { useCompanionPlaybackMicHandoff } from './companion-playback-mic-handoff'
import { CompanionNoticeToast } from './CompanionNoticeToast'
import { CompanionTurnList } from './CompanionTurnList'
import {
  describeListenStartError,
  micPermissionError,
  type CompanionPanelError
} from './companion-panel-errors'

const COMPANION_SESSION_ID = 'companion'

export type CompanionTurn = {
  id: number
  role: 'user' | 'assistant'
  text: string
  isError?: boolean
  /** Voice focus dropped this segment (not the owner's voice) — shown dim, only when
   *  "показывать отброшенное" is on. */
  isDropped?: boolean
}

/**
 * Floating always-listening panel. The hotkey (handled in main) shows/hides
 * this window; this component owns the dictation loop itself, reusing the
 * shared mic-capture hook and `speech:*` IPC — no parallel audio pipeline.
 * The reply itself (streamed text, TTS playback state) is driven by main's
 * dialogue orchestrator over `companion:assistant*`/`companion:stateChanged`.
 */
export function CompanionPanel(): React.JSX.Element {
  const [isActive, setIsActive] = useState(false)
  const [partialText, setPartialText] = useState('')
  const [turns, setTurns] = useState<CompanionTurn[]>([])
  const [turnState, setTurnState] = useState<CompanionConversationState>('listening')
  const [error, setError] = useState<CompanionPanelError | null>(null)
  const [notice, setNotice] = useState<CompanionAgentNotice | null>(null)
  // Why: the default offline GigaAM model never emits `speech:partial` (see
  // CompanionPanel's `restartForNextUtterance` comment), so this live mic
  // level is the only moment-to-moment feedback the user gets while
  // speaking — rendered as a small level meter next to "Слушаю…".
  const [meterLevel, setMeterLevel] = useState(0)
  const hold = useCompanionUtteranceHoldWiring()
  const { start: startCapture, stop: stopCapture } = useAudioCapture(
    useCallback(
      (meter) => {
        meterStateRef.current = meter
        setMeterLevel(meter.level)
        utterancePeakLevelRef.current = Math.max(utterancePeakLevelRef.current, meter.level)
        // The user resumed talking during a dangling-utterance hold — cancel the pending
        // submit-as-is timeout; the normal end-of-utterance flow takes over from here.
        if (meter.isSpeaking) {
          hold.cancelHoldOnSpeaking()
        }
        // Lets the main-process hotkey handler tell "press while mid-utterance"
        // (finalize now) from "press while idle" (toggle) — see decideHotkeyPressAction.
        if (meter.isSpeaking !== lastReportedSpeakingRef.current) {
          lastReportedSpeakingRef.current = meter.isSpeaking
          void window.api.companion.reportSpeakingState(meter.isSpeaking)
        }
      },
      [hold]
    )
  )

  const settingsRef = useRef<CompanionSettings>(getDefaultCompanionSettings())
  const isStreamingModelRef = useRef(false)
  const isActiveRef = useRef(false)
  const isPlayingAudioRef = useRef(false)
  const turnIdRef = useRef(0)
  const currentAssistantTurnIdRef = useRef<number | null>(null)
  const meterStateRef = useRef({ level: 0, isSpeaking: false, isClipping: false })
  // Loudest meter level since the last final — wake mode's follow-up filter compares it.
  const utterancePeakLevelRef = useRef(0)
  const silenceStartedAtRef = useRef<number | null>(null)
  const hasAudioSinceLastFinalRef = useRef(false)
  const restartingRef = useRef(false)
  const lastReportedSpeakingRef = useRef(false)
  // True once this session has seen at least one real `speech:segmentEnd` — from then
  // on VAD drives end-of-utterance instead of the energy-timer fallback below.
  const vadActiveRef = useRef(false)
  // The most recent VAD segment's speaker embedding, consumed (cleared) by
  // CompanionUtteranceHoldWiringDeps.getPendingEmbedding at submit time.
  const pendingEmbeddingRef = useRef<number[] | null>(null)

  const { listeningThroughPlaybackRef, refreshSettings } = useCompanionPlaybackMicHandoff({
    sessionId: COMPANION_SESSION_ID,
    settingsRef,
    isActiveRef,
    isPlayingAudioRef,
    hasAudioSinceLastFinalRef,
    startCapture,
    stopCapture
  })

  const resetSilenceTracking = useCallback((): void => {
    silenceStartedAtRef.current = null
  }, [])

  const appendUserTurn = useCallback((text: string): void => {
    turnIdRef.current += 1
    // The next assistant delta starts a fresh bubble, never appends to a prior reply.
    currentAssistantTurnIdRef.current = null
    setTurns((prev) => [...prev, { id: turnIdRef.current, role: 'user', text }])
  }, [])

  // Voice focus dropped this segment (not the owner's voice); only called when
  // "показывать отброшенное" is on, so it always renders — the caller already checked.
  const appendDroppedTurn = useCallback((text: string): void => {
    turnIdRef.current += 1
    currentAssistantTurnIdRef.current = null
    setTurns((prev) => [...prev, { id: turnIdRef.current, role: 'user', text, isDropped: true }])
  }, [])

  const getPendingEmbedding = useCallback((): number[] | null => {
    const embedding = pendingEmbeddingRef.current
    pendingEmbeddingRef.current = null
    return embedding
  }, [])

  const ensureAssistantTurn = useCallback((): number => {
    if (currentAssistantTurnIdRef.current !== null) {
      return currentAssistantTurnIdRef.current
    }
    turnIdRef.current += 1
    const id = turnIdRef.current
    currentAssistantTurnIdRef.current = id
    setTurns((prev) => [...prev, { id, role: 'assistant', text: '' }])
    return id
  }, [])

  const stopListening = useCallback((): void => {
    resetSilenceTracking()
    hold.clearHold()
    isActiveRef.current = false
    setIsActive(false)
    setPartialText('')
    setMeterLevel(0)
    vadActiveRef.current = false
    pendingEmbeddingRef.current = null
    stopCapture()
    void window.api.speech.stopDictation(COMPANION_SESSION_ID)
  }, [resetSilenceTracking, hold, stopCapture])
  hold.depsRef.current = {
    appendUserTurn,
    stopListening,
    getPendingEmbedding,
    onVoiceDropped: (text) => {
      if (settingsRef.current.voiceFocus.showDropped) {
        appendDroppedTurn(text)
      }
    }
  }

  const beginDictationSession = useCallback(async (): Promise<void> => {
    try {
      await window.api.speech.startDictation(
        settingsRef.current.sttModel,
        undefined,
        COMPANION_SESSION_ID
      )
      await startCapture({ sessionId: COMPANION_SESSION_ID })
      setError(null)
      void window.api.companion.reportListeningHealth({ ok: true })
    } catch (err) {
      const panelError = describeListenStartError(err)
      setError(panelError)
      void window.api.companion.reportListeningHealth({ ok: false, error: panelError.message })
    }
  }, [startCapture])

  // Why: the bundled default STT model is an offline/chunked recognizer with no
  // built-in endpointing (see stt-worker.ts: only the streaming transducer/
  // paraformer configs set `enableEndpoint`). For those models the panel forces
  // one utterance per silence gap itself by cycling stop/startDictation, which
  // flushes the offline recognizer's buffered audio as a single final chunk.
  const restartForNextUtterance = useCallback(async (): Promise<void> => {
    if (restartingRef.current || !isActiveRef.current) {
      return
    }
    restartingRef.current = true
    try {
      await window.api.speech.stopDictation(COMPANION_SESSION_ID)
      if (isActiveRef.current) {
        await beginDictationSession()
      }
    } finally {
      restartingRef.current = false
      hasAudioSinceLastFinalRef.current = false
    }
  }, [beginDictationSession])

  const startListening = useCallback(
    async (resetTranscript: boolean): Promise<void> => {
      if (resetTranscript) {
        setTurns([])
      }
      currentAssistantTurnIdRef.current = null
      setTurnState('listening')
      refreshSettings()
      // Why visible before the permission check: a denial still needs the panel up so
      // the error banner (with its "open Settings" button) has somewhere to render.
      isActiveRef.current = true
      setIsActive(true)
      vadActiveRef.current = false
      hasAudioSinceLastFinalRef.current = false
      // Reuses the same macOS TCC check/prompt the desktop dictation panel uses
      // (`developerPermissions:request` → `systemPreferences.askForMediaAccess`), so a
      // previously-denied mic falls straight to the Privacy pane instead of a silent stream.
      const permission = await window.api.developerPermissions.request({ id: 'microphone' })
      if (permission.status !== 'granted' && permission.status !== 'unsupported') {
        const panelError = micPermissionError()
        setError(panelError)
        void window.api.companion.reportListeningHealth({ ok: false, error: panelError.message })
        return
      }
      await beginDictationSession()
    },
    [beginDictationSession, refreshSettings]
  )

  // Energy-based end-of-utterance: watches the mic meter (already computed by
  // the shared capture hook) for a trailing-silence window, then forces a final.
  useEffect(() => {
    if (!isActive || isStreamingModelRef.current) {
      return
    }
    const interval = setInterval(() => {
      if (
        !isActiveRef.current ||
        restartingRef.current ||
        vadActiveRef.current ||
        (isPlayingAudioRef.current && !listeningThroughPlaybackRef.current)
      ) {
        return
      }
      if (meterStateRef.current.isSpeaking) {
        hasAudioSinceLastFinalRef.current = true
        resetSilenceTracking()
        return
      }
      if (!hasAudioSinceLastFinalRef.current) {
        return
      }
      if (silenceStartedAtRef.current === null) {
        silenceStartedAtRef.current = Date.now()
        return
      }
      // Why 150ms poll instead of a nested setTimeout: a timer scheduled from
      // inside this interval can't be unmount-cleaned reliably by static
      // analysis, and a poll is just as accurate within the 150ms slack below.
      if (
        Date.now() - silenceStartedAtRef.current >=
        settingsRef.current.endOfUtteranceSeconds * 1000
      ) {
        silenceStartedAtRef.current = null
        void restartForNextUtterance()
      }
    }, 150)
    return () => {
      clearInterval(interval)
    }
  }, [isActive, listeningThroughPlaybackRef, resetSilenceTracking, restartForNextUtterance])

  const handleFinalText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      setPartialText('')
      const level = utterancePeakLevelRef.current
      utterancePeakLevelRef.current = 0
      hold.handleFinalText(trimmed, level)
    },
    [hold]
  )

  useEffect(() => {
    const offPartial = window.api.speech.onPartialTranscript((data) => {
      if (data.sessionId === COMPANION_SESSION_ID) {
        setPartialText(data.text)
      }
    })
    const offFinal = window.api.speech.onFinalTranscript((data) => {
      if (data.sessionId === COMPANION_SESSION_ID) {
        handleFinalText(data.text)
      }
    })
    // VAD end-of-utterance, once active for this session, replaces the energy-timer
    // fallback above entirely (see vadActiveRef's gate in that effect) — a real segment
    // boundary is more accurate than a trailing-silence guess, especially with
    // background noise. finalizeNow() (hotkey-while-speaking) fires this same event.
    const offSegmentEnd = window.api.speech.onSegmentEnd((data) => {
      if (data.sessionId !== COMPANION_SESSION_ID) {
        return
      }
      vadActiveRef.current = true
      pendingEmbeddingRef.current = data.embedding
      if (!restartingRef.current && isActiveRef.current) {
        void restartForNextUtterance()
      }
    })
    return () => {
      offPartial()
      offFinal()
      offSegmentEnd()
    }
  }, [handleFinalText, restartForNextUtterance])

  useEffect(() => {
    const offOpened = window.api.companion.onConversationOpened(() => {
      void startListening(true)
    })
    const offClosed = window.api.companion.onConversationClosed(() => {
      stopListening()
    })
    return () => {
      offOpened()
      offClosed()
    }
  }, [startListening, stopListening])

  // Why: hydrate settings + catalog once, and pick up an already-open
  // conversation if the panel remounts (HMR, or a fresh window) mid-session.
  useCompanionStartupHydration({ settingsRef, isStreamingModelRef, startListening })

  // Streamed reply state, pushed by main's dialogue orchestrator.
  useCompanionAssistantReplyStream({ ensureAssistantTurn, setTurns, currentAssistantTurnIdRef })

  useEffect(() => {
    return window.api.companion.onStateChanged(setTurnState)
  }, [])

  useEffect(() => {
    return window.api.companion.onConversationReset(() => {
      setTurns([])
      currentAssistantTurnIdRef.current = null
      setPartialText('')
      hold.clearHold()
    })
  }, [hold])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        void window.api.companion.hide().then(({ keepListening }) => {
          if (!keepListening) {
            stopListening()
          }
        })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stopListening])

  useEffect(() => {
    const offNotice = window.api.companion.onNotice(setNotice)
    const offNoticeDismiss = window.api.companion.onNoticeDismiss((payload) => {
      setNotice((current) => (current?.id === payload.id ? null : current))
    })
    return () => {
      offNotice()
      offNoticeDismiss()
    }
  }, [])

  const respondToNotice = useCallback(
    (action: 'discuss' | 'later'): void => {
      if (!notice) {
        return
      }
      void window.api.companion.respondToNotice({ id: notice.id, action })
      setNotice(null)
    },
    [notice]
  )

  const noticeToast = notice ? (
    <CompanionNoticeToast notice={notice} onRespond={respondToNotice} />
  ) : null

  if (!isActive) {
    return <div className="size-full bg-transparent">{noticeToast}</div>
  }

  const stateLabel =
    turnState === 'thinking'
      ? translate('companion.panel.thinking', 'Думаю…')
      : turnState === 'speaking'
        ? translate('companion.panel.speaking', 'Говорю…')
        : translate('companion.panel.listening', 'Слушаю…')
  const StateIcon = turnState === 'thinking' ? Loader2 : turnState === 'speaking' ? Volume2 : Mic

  return (
    <div className="flex size-full flex-col gap-2 rounded-2xl border border-white/10 bg-black/80 p-4 text-sm text-white shadow-2xl backdrop-blur-xl">
      {noticeToast}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/60">
          {turnState === 'listening' ? (
            <DictationGrapes level={meterLevel} active={isActive} transitioning={false} />
          ) : (
            <StateIcon className={cn('size-3', turnState === 'thinking' && 'animate-spin')} />
          )}
          {stateLabel}
        </div>
        <button
          type="button"
          onClick={() => void window.api.companion.resetConversation()}
          className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white/80"
          title={translate('companion.panel.newConversation', 'Новый разговор')}
          aria-label={translate('companion.panel.newConversation', 'Новый разговор')}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>

      <CompanionTurnList turns={turns} isHolding={hold.isHolding} partialText={partialText} />

      {error && (
        <div className="flex flex-col items-start gap-1.5 text-xs text-destructive">
          <span>{error.message}</span>
          {error.kind === 'mic-permission' && (
            <button
              type="button"
              onClick={() =>
                void window.api.developerPermissions.openSettings({ id: 'microphone' })
              }
              className="rounded-md bg-white/15 px-2 py-1 font-medium text-white hover:bg-white/25"
            >
              {translate('companion.panel.openMicSettings', 'Открыть настройки')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
