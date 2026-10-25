import type {
  CompanionQwenEmotion,
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionTtsVoice
} from '../../../../shared/companion-types'
import {
  isCompanionQwen3TtsSupported,
  isCompanionSileroTtsSupported
} from '../../../../shared/companion-tts-support'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { CompanionYandexTtsSettingsSection } from './CompanionYandexTtsSettingsSection'

const TTS_VOICE_LABELS: Record<CompanionTtsVoice, string> = {
  eugene: 'Евгений',
  aidar: 'Айдар',
  xenia: 'Ксения',
  baya: 'Бая',
  kseniya: 'Ксения (Silero)'
}

const TTS_VOICE_OPTIONS: CompanionTtsVoice[] = ['eugene', 'aidar', 'xenia', 'baya', 'kseniya']

const QWEN_EMOTION_OPTIONS: {
  value: CompanionQwenEmotion
  fallbackLabel: string
}[] = [
  { value: 'neutral', fallbackLabel: 'Нейтрально' },
  { value: 'warm', fallbackLabel: 'Тепло' },
  { value: 'mentor', fallbackLabel: 'Спокойно, как наставник' }
]

function isCompanionQwenEmotion(value: string): value is CompanionQwenEmotion {
  return value === 'neutral' || value === 'warm' || value === 'mentor'
}

function isCompanionTtsVoice(value: string): value is CompanionTtsVoice {
  switch (value) {
    case 'eugene':
    case 'aidar':
    case 'xenia':
    case 'baya':
    case 'kseniya':
      return true
    default:
      return false
  }
}

function TtsProvisioningRow({
  status
}: {
  status: CompanionTtsProvisioningStatus | null
}): React.JSX.Element | null {
  if (!status || status.status === 'idle') {
    return null
  }
  const isQwen3 = status.engine === 'qwen3'
  if (status.status === 'downloading') {
    return (
      <p className="text-xs text-muted-foreground">
        {isQwen3
          ? translate(
              'auto.components.settings.CompanionPane.tts.qwen3Downloading',
              'Загрузка Qwen3-TTS (~3 ГБ), пока говорит Silero…'
            )
          : translate(
              'auto.components.settings.CompanionPane.tts.downloading',
              'Загрузка голоса…'
            )}{' '}
        {status.progress !== undefined ? `${Math.round(status.progress)}%` : ''}
      </p>
    )
  }
  if (status.status === 'error') {
    return (
      <p className="text-xs text-destructive">
        {isQwen3
          ? translate(
              'auto.components.settings.CompanionPane.tts.qwen3Error',
              'Qwen3-TTS не установился, говорит Silero.'
            )
          : null}{' '}
        {status.error ??
          translate(
            'auto.components.settings.CompanionPane.tts.error',
            'Не удалось загрузить голос.'
          )}
      </p>
    )
  }
  return (
    <p className="text-xs text-status-success">
      {isQwen3
        ? translate('auto.components.settings.CompanionPane.tts.qwen3Ready', 'Голос Qwen3 готов.')
        : translate('auto.components.settings.CompanionPane.tts.ready', 'Голос готов.')}
    </p>
  )
}

type CompanionTtsSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateTtsSettings: (updates: Partial<CompanionSettings['tts']>) => void
  ttsProvisioningStatus: CompanionTtsProvisioningStatus | null
}

/** The companion's озвучка (TTS) rows: enable, voice, rate — split out of `CompanionPane`
 *  to keep that file under the repo's per-file line cap. */
export function CompanionTtsSettingsSection({
  companionSettings,
  updateTtsSettings,
  ttsProvisioningStatus
}: CompanionTtsSettingsSectionProps): React.JSX.Element {
  const { platform, arch } = window.api.platform.get()
  const sileroSupported = isCompanionSileroTtsSupported(platform, arch)
  const isYandex = companionSettings.tts.provider === 'yandex'
  const qwen3Supported = isCompanionQwen3TtsSupported(platform, arch)
  const isQwen3 = qwen3Supported && companionSettings.tts.provider === 'qwen3'
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.ttsEnable', 'Озвучивать ответы')}
          </Label>
          {/* Why: provisioning never runs for Yandex, so a Silero status shown there is
              stale; where Silero cannot run at all, say so instead of a raw error. */}
          {!sileroSupported ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionPane.tts.sileroUnsupported',
                'Локальный голос Silero работает только на Mac с Apple Silicon. Здесь озвучивает Яндекс SpeechKit.'
              )}
            </p>
          ) : isYandex ? null : (
            <TtsProvisioningRow status={ttsProvisioningStatus} />
          )}
        </div>
        <Switch
          checked={companionSettings.tts.ttsEnabled}
          onCheckedChange={(checked) => updateTtsSettings({ ttsEnabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.ttsEnable',
            'Озвучивать ответы'
          )}
        />
      </div>

      <Separator />

      {sileroSupported ? (
        <>
          <div className="flex items-center justify-between gap-4 py-2">
            <Label>
              {isYandex || isQwen3
                ? translate(
                    'auto.components.settings.CompanionPane.ttsVoiceFallback',
                    'Голос Silero (запасной)'
                  )
                : translate('auto.components.settings.CompanionPane.ttsVoice', 'Голос')}
            </Label>
            <Select
              value={companionSettings.tts.ttsVoice}
              onValueChange={(value) => {
                if (isCompanionTtsVoice(value)) {
                  updateTtsSettings({ ttsVoice: value })
                }
              }}
            >
              <SelectTrigger className="w-40 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_VOICE_OPTIONS.map((voice) => (
                  <SelectItem key={voice} value={voice}>
                    {TTS_VOICE_LABELS[voice]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />
        </>
      ) : null}

      <div className="space-y-1.5 py-2">
        <div className="flex items-center justify-between gap-4">
          <Label>
            {translate('auto.components.settings.CompanionPane.ttsRate', 'Скорость озвучки')}
          </Label>
          <span className="text-xs text-muted-foreground">
            {new Intl.NumberFormat(getIntlLocale(), {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }).format(companionSettings.tts.ttsRate)}
            ×
          </span>
        </div>
        <Slider
          min={0.7}
          max={1.6}
          step={0.05}
          value={[companionSettings.tts.ttsRate]}
          onValueChange={([value]) => updateTtsSettings({ ttsRate: value })}
        />
      </div>

      <Separator />

      <CompanionYandexTtsSettingsSection
        companionSettings={companionSettings}
        updateTtsSettings={updateTtsSettings}
        qwen3Supported={qwen3Supported}
      />

      {isQwen3 ? (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-4 py-2">
            <div className="space-y-0.5">
              <Label>
                {translate('auto.components.settings.CompanionPane.qwenEmotion', 'Интонация Qwen3')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionPane.qwenEmotionHint',
                  'Только для Apple Silicon. Пока модель не скачана или не запустилась, говорит Silero.'
                )}
              </p>
            </div>
            <Select
              value={companionSettings.tts.qwenEmotion}
              onValueChange={(value) => {
                if (isCompanionQwenEmotion(value)) {
                  updateTtsSettings({ qwenEmotion: value })
                }
              }}
            >
              <SelectTrigger className="w-56 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QWEN_EMOTION_OPTIONS.map(({ value, fallbackLabel }) => (
                  <SelectItem key={value} value={value}>
                    {translate(
                      `auto.components.settings.CompanionPane.qwenEmotion.${value}`,
                      fallbackLabel
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      ) : null}
    </>
  )
}
