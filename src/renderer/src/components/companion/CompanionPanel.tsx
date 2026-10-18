import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, RotateCcw, Volume2 } from 'lucide-react'
import { useAudioCapture } from '@/hooks/use-audio-capture'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  CompanionAgentNotice,
  CompanionConversationState,
  CompanionSettings
} from '../../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../../shared/constants'
import { useCompanionAudioPlayback } from './companion-audio-playback'
import { CompanionNoticeToast } from './CompanionNoticeToast'
import {
  describeListenStartError,
  micPermissionError,
  type CompanionPanelError
} from './companion-panel-errors'

const COMPANION_SESSION_ID = 'companion'

type CompanionTurn = {
  id: number
  role: 'user' | 'assistant'
  text: string
  isError?: boolean
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

  const { start: startCapture, stop: stopCapture } = useAudioCapture(
    useCallback((meter) => {
      meterStateRef.current = meter
    }, [])
  )

  const settingsRef = useRef<CompanionSettings>(getDefaultCompanionSettings())
  const isStreamingModelRef = useRef(false)
  const isActiveRef = useRef(false)
  const isPlayingAudioRef = useRef(false)
  const turnIdRef = useRef(0)
  const currentAssistantTurnIdRef = useRef<number | null>(null)
  const meterStateRef = useRef({ level: 0, isSpeaking: false, isClipping: false })
  const silenceStartedAtRef = useRef<number | null>(null)
  const hasAudioSinceLastFinalRef = useRef(false)
  const restartingRef = useRef(false)

  useCompanionAudioPlayback({
    onPlaybackChange: useCallback(
      (playing: boolean) => {
        isPlayingAudioRef.current = playing
        // Why: the companion must never transcribe its own TTS voice — stop
        // feeding the mic while audio plays, resume once it ends/stops.
        if (playing) {
          stopCapture()
        } else if (isActiveRef.current) {
          void startCapture({ sessionId: COMPANION_SESSION_ID })
        }
      },
      [startCapture, stopCapture]
    )
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
    isActiveRef.current = false
    setIsActive(false)
    setPartialText('')
    stopCapture()
    void window.api.speech.stopDictation(COMPANION_SESSION_ID)
  }, [resetSilenceTracking, stopCapture])

  const beginDictationSession = useCallback(async (): Promise<void> => {
    try {
      await window.api.speech.startDictation(
        settingsRef.current.sttModel,
        undefined,
        COMPANION_SESSION_ID
      )
      await startCapture({ sessionId: COMPANION_SESSION_ID })
      setError(null)
    } catch (err) {
      setError(describeListenStartError(err))
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
      // Why visible before the permission check: a denial still needs the panel up so
      // the error banner (with its "open Settings" button) has somewhere to render.
      isActiveRef.current = true
      setIsActive(true)
      hasAudioSinceLastFinalRef.current = false
      // Reuses the same macOS TCC check/prompt the desktop dictation panel uses
      // (`developerPermissions:request` → `systemPreferences.askForMediaAccess`), so a
      // previously-denied mic falls straight to the Privacy pane instead of a silent stream.
      const permission = await window.api.developerPermissions.request({ id: 'microphone' })
      if (permission.status !== 'granted' && permission.status !== 'unsupported') {
        setError(micPermissionError())
        return
      }
      await beginDictationSession()
    },
    [beginDictationSession]
  )

  // Energy-based end-of-utterance: watches the mic meter (already computed by
  // the shared capture hook) for a trailing-silence window, then forces a final.
  useEffect(() => {
    if (!isActive || isStreamingModelRef.current) {
      return
    }
    const interval = setInterval(() => {
      if (!isActiveRef.current || restartingRef.current || isPlayingAudioRef.current) {
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
      if (Date.now() - silenceStartedAtRef.current >= settingsRef.current.endOfUtteranceMs) {
        silenceStartedAtRef.current = null
        void restartForNextUtterance()
      }
    }, 150)
    return () => {
      clearInterval(interval)
    }
  }, [isActive, resetSilenceTracking, restartForNextUtterance])

  const handleFinalText = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (trimmed === '') {
        return
      }
      setPartialText('')
      appendUserTurn(trimmed)
      const result = await window.api.companion.reportUtterance(trimmed)
      if (result.stopped) {
        stopListening()
      }
    },
    [appendUserTurn, stopListening]
  )

  useEffect(() => {
    const offPartial = window.api.speech.onPartialTranscript((data) => {
      if (data.sessionId === COMPANION_SESSION_ID) {
        setPartialText(data.text)
      }
    })
    const offFinal = window.api.speech.onFinalTranscript((data) => {
      if (data.sessionId === COMPANION_SESSION_ID) {
        void handleFinalText(data.text)
      }
    })
    return () => {
      offPartial()
      offFinal()
    }
  }, [handleFinalText])

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
  }, [startListening])

  // Streamed reply state, pushed by main's dialogue orchestrator.
  useEffect(() => {
    const offDelta = window.api.companion.onAssistantDelta((text) => {
      const id = ensureAssistantTurn()
      setTurns((prev) =>
        prev.map((turn) => (turn.id === id ? { ...turn, text: turn.text + text } : turn))
      )
    })
    const offFinal = window.api.companion.onAssistantFinal((text) => {
      const id = ensureAssistantTurn()
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, text } : turn)))
      currentAssistantTurnIdRef.current = null
    })
    const offAssistantError = window.api.companion.onAssistantError((message) => {
      const id = ensureAssistantTurn()
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? {
                ...turn,
                text: translate(
                  'companion.panel.brainError',
                  'Не получилось ответить: {{message}}',
                  { message }
                ),
                isError: true
              }
            : turn
        )
      )
      currentAssistantTurnIdRef.current = null
    })
    return () => {
      offDelta()
      offFinal()
      offAssistantError()
    }
  }, [ensureAssistantTurn])

  useEffect(() => {
    return window.api.companion.onStateChanged(setTurnState)
  }, [])

  useEffect(() => {
    return window.api.companion.onConversationReset(() => {
      setTurns([])
      currentAssistantTurnIdRef.current = null
      setPartialText('')
    })
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        void window.api.companion.hide()
        stopListening()
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
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-status-success" />
            </span>
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

      <div className="scrollbar-sleek flex-1 space-y-1.5 overflow-y-auto">
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={cn(
              'rounded-lg px-2.5 py-1.5 whitespace-pre-wrap',
              turn.role === 'user' ? 'bg-white/5 text-white/90' : 'bg-white/10 text-white',
              turn.isError && 'text-destructive'
            )}
          >
            {turn.text}
          </div>
        ))}
        {partialText !== '' && (
          <div className="rounded-lg px-2.5 py-1.5 text-white/50 italic">{partialText}</div>
        )}
      </div>

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
