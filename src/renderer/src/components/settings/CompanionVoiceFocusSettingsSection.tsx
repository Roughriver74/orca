import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CompanionSettings,
  CompanionVoiceEnrollmentStatus,
  CompanionVoiceFocusStrictness
} from '../../../../shared/companion-types'
import type { SpeechModelState } from '../../../../shared/speech-types'
import { openMicrophoneCaptureStream } from '../dictation/microphone-devices'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Separator } from '../ui/separator'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { translate } from '@/i18n/i18n'

type CompanionVoiceFocusSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateCompanionSettings: (updates: Partial<CompanionSettings>) => void
}

const STRICTNESS_OPTIONS: CompanionVoiceFocusStrictness[] = ['low', 'medium', 'high']
const STRICTNESS_LABELS: Record<CompanionVoiceFocusStrictness, string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая'
}

function isCompanionVoiceFocusStrictness(value: string): value is CompanionVoiceFocusStrictness {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: widening the readonly strictness tuple to string[] only to use Array.includes' string overload.
  return (STRICTNESS_OPTIONS as string[]).includes(value)
}

// Three short phrases shown one at a time; ~20s total recording lines up with the
// assignment's "≈20 s total" — each phrase gets ~6-7s to speak comfortably.
const ENROLLMENT_PHRASES = [
  'Джарвис, привет, это я.',
  'Сегодня хорошая погода для прогулки.',
  'Повтори последнее, что я сказал.'
]
const PHRASE_RECORD_MS = 7000

const FOCUS_ASSET_IDS = ['silero-vad', 'speaker-embedding-campplus', 'gtcrn-denoiser'] as const

function assetReady(states: SpeechModelState[], id: string): boolean {
  return states.find((s) => s.id === id)?.status === 'ready'
}

/** Records ENROLLMENT_PHRASES.length short phrases through the mic and sends each to
 *  companion:voiceFocus:enrollPhrase. Uses the same device-resolution helper as dictation
 *  capture (openMicrophoneCaptureStream) but its own minimal AudioContext pipeline — the
 *  shared useAudioCapture hook feeds speech:feedAudio unconditionally, which would also
 *  start transcribing the enrollment phrases as if they were dictation. */
function useVoiceEnrollmentRecorder(onDone: (status: CompanionVoiceEnrollmentStatus) => void): {
  phraseIndex: number
  isRecording: boolean
  error: string | null
  start: () => void
} {
  const [phraseIndex, setPhraseIndex] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)

  const recordOnePhrase = useCallback(async (): Promise<void> => {
    const { stream } = await openMicrophoneCaptureStream({
      preferredDeviceId: null,
      getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
    })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const processor = context.createScriptProcessor(4096, 1, 1)
    const chunks: Float32Array[] = []
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
    }
    source.connect(processor)
    processor.connect(context.destination)

    const { promise: recordDelay, resolve: resolveRecordDelay } = Promise.withResolvers<void>()
    setTimeout(resolveRecordDelay, PHRASE_RECORD_MS)
    await recordDelay

    processor.disconnect()
    source.disconnect()
    stream.getTracks().forEach((track) => track.stop())
    const sampleRate = context.sampleRate
    await context.close()

    if (cancelledRef.current) {
      return
    }
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const merged = new Float32Array(totalLength)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    const status = await window.api.companionVoiceFocus.enrollPhrase(merged, sampleRate)
    onDone(status)
  }, [onDone])

  const start = useCallback(() => {
    cancelledRef.current = false
    setError(null)
    setPhraseIndex(0)
    setIsRecording(true)
    void (async () => {
      try {
        for (let i = 0; i < ENROLLMENT_PHRASES.length; i += 1) {
          if (cancelledRef.current) {
            return
          }
          setPhraseIndex(i)
          await recordOnePhrase()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setIsRecording(false)
      }
    })()
  }, [recordOnePhrase])

  useEffect(
    () => () => {
      cancelledRef.current = true
    },
    []
  )

  return { phraseIndex, isRecording, error, start }
}

function CompanionVoiceEnrollmentCard({ modelReady }: { modelReady: boolean }): React.JSX.Element {
  const [status, setStatus] = useState<CompanionVoiceEnrollmentStatus | null>(null)

  useEffect(() => {
    void window.api.companionVoiceFocus.getEnrollmentStatus().then(setStatus)
  }, [])

  const { phraseIndex, isRecording, error, start } = useVoiceEnrollmentRecorder(setStatus)

  const handleClear = (): void => {
    void window.api.companionVoiceFocus.clearEnrollment().then(setStatus)
  }

  return (
    <div className="space-y-1.5 py-2">
      <Label>
        {translate('auto.components.settings.CompanionPane.voiceEnrollTitle', 'Голос владельца')}
      </Label>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.CompanionPane.voiceEnrollDescription',
          'Запишите 3 коротких фразы — Джарвис научится узнавать ваш голос и не будет реагировать на телевизор или чужую речь.'
        )}
      </p>
      {!modelReady && (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.CompanionPane.voiceEnrollModelDownloading',
            'Модель распознавания голоса ещё скачивается…'
          )}
        </p>
      )}
      {isRecording && (
        <p className="text-xs text-foreground">
          {translate(
            'auto.components.settings.CompanionPane.voiceEnrollPhrasePrompt',
            'Скажите: «{{phrase}}» ({{index}}/{{total}})',
            {
              phrase: ENROLLMENT_PHRASES[phraseIndex] ?? '',
              index: phraseIndex + 1,
              total: ENROLLMENT_PHRASES.length
            }
          )}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!isRecording && status && (
        <p className="text-xs text-muted-foreground">
          {status.enrolled
            ? translate(
                'auto.components.settings.CompanionPane.voiceEnrollStatusEnrolled',
                'Записано фраз: {{count}}',
                { count: status.phraseCount }
              )
            : translate(
                'auto.components.settings.CompanionPane.voiceEnrollStatusEmpty',
                'Голос ещё не записан'
              )}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!modelReady || isRecording}
          onClick={() => {
            if (status?.enrolled) {
              handleClear()
            }
            start()
          }}
        >
          {status?.enrolled
            ? translate(
                'auto.components.settings.CompanionPane.voiceEnrollReRecord',
                'Перезаписать'
              )
            : translate(
                'auto.components.settings.CompanionPane.voiceEnrollRecord',
                'Записать голос'
              )}
        </Button>
        {status?.enrolled && !isRecording && (
          <Button size="sm" variant="ghost" onClick={handleClear}>
            {translate('auto.components.settings.CompanionPane.voiceEnrollClear', 'Удалить запись')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** VAD end-of-utterance + "Голос владельца" speaker verification: robust turn-taking and
 *  focus in a noisy room (TV, other people) — see companion-voice-focus.ts for the
 *  matching policy and companion-assets.ts for the model auto-download. */
export function CompanionVoiceFocusSettingsSection({
  companionSettings,
  updateCompanionSettings
}: CompanionVoiceFocusSettingsSectionProps): React.JSX.Element {
  const { voiceFocus } = companionSettings
  const [assetStates, setAssetStates] = useState<SpeechModelState[]>([])

  const updateVoiceFocus = useCallback(
    (updates: Partial<CompanionSettings['voiceFocus']>): void => {
      updateCompanionSettings({ voiceFocus: { ...voiceFocus, ...updates } })
    },
    [voiceFocus, updateCompanionSettings]
  )

  useEffect(() => {
    if (!voiceFocus.enabled) {
      return
    }
    let cancelled = false
    const poll = (): void => {
      void window.api.companionVoiceFocus.getAssetStatus().then((states) => {
        if (!cancelled) {
          setAssetStates(states)
        }
      })
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [voiceFocus.enabled])

  const vadReady = assetReady(assetStates, FOCUS_ASSET_IDS[0])
  const speakerModelReady = assetReady(assetStates, FOCUS_ASSET_IDS[1])

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.CompanionPane.voiceFocusEnable',
              'Фокус на голосе'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.voiceFocusEnableDescription',
              'Определять конец фразы по голосу (а не по громкости) и отличать ваш голос от телевизора и чужой речи.'
            )}
          </p>
        </div>
        <Switch
          checked={voiceFocus.enabled}
          onCheckedChange={(checked) => updateVoiceFocus({ enabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.voiceFocusEnable',
            'Фокус на голосе'
          )}
        />
      </div>

      {voiceFocus.enabled && (
        <>
          <Separator />

          {!vadReady && (
            <p className="py-2 text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionPane.voiceFocusModelDownloading',
                'Скачивается модель определения конца фразы…'
              )}
            </p>
          )}

          <div className="space-y-1.5 py-2">
            <div className="flex items-center justify-between gap-4">
              <Label>
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusEndOfUtterance',
                  'Пауза для завершения фразы'
                )}
              </Label>
              <span className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionPane.endOfUtteranceSeconds',
                  '{{seconds}} с',
                  { seconds: voiceFocus.endOfUtteranceSeconds.toFixed(1) }
                )}
              </span>
            </div>
            <Slider
              min={0.3}
              max={5}
              step={0.1}
              value={[voiceFocus.endOfUtteranceSeconds]}
              onValueChange={([value]) => updateVoiceFocus({ endOfUtteranceSeconds: value })}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4 py-2">
            <div className="space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusDenoiser',
                  'Подавление шума'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusDenoiserDescription',
                  'Очищать звук от фонового шума перед распознаванием (немного больше нагрузки на процессор).'
                )}
              </p>
            </div>
            <Switch
              checked={voiceFocus.denoiserEnabled}
              onCheckedChange={(checked) => updateVoiceFocus({ denoiserEnabled: checked })}
              aria-label={translate(
                'auto.components.settings.CompanionPane.voiceFocusDenoiser',
                'Подавление шума'
              )}
            />
          </div>

          <Separator />

          <CompanionVoiceEnrollmentCard modelReady={speakerModelReady} />

          <Separator />

          <div className="flex items-center justify-between gap-4 py-2">
            <div className="space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusStrictness',
                  'Строгость'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusStrictnessDescription',
                  'Насколько точно голос должен совпадать с записанным, чтобы Джарвис среагировал.'
                )}
              </p>
            </div>
            <Select
              value={voiceFocus.strictness}
              onValueChange={(value) => {
                if (isCompanionVoiceFocusStrictness(value)) {
                  updateVoiceFocus({ strictness: value })
                }
              }}
            >
              <SelectTrigger className="w-32 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRICTNESS_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {STRICTNESS_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4 py-2">
            <div className="space-y-0.5">
              <Label>
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusShowDropped',
                  'Показывать отброшенное'
                )}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionPane.voiceFocusShowDroppedDescription',
                  'В чате появится приглушённая строка «не твой голос — пропущено» для каждой отброшенной фразы.'
                )}
              </p>
            </div>
            <Switch
              checked={voiceFocus.showDropped}
              onCheckedChange={(checked) => updateVoiceFocus({ showDropped: checked })}
              aria-label={translate(
                'auto.components.settings.CompanionPane.voiceFocusShowDropped',
                'Показывать отброшенное'
              )}
            />
          </div>
        </>
      )}
    </>
  )
}
