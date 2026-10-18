import type {
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionTtsVoice
} from '../../../../shared/companion-types'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { translate } from '@/i18n/i18n'
import { CompanionYandexTtsSettingsSection } from './CompanionYandexTtsSettingsSection'

const TTS_VOICE_LABELS: Record<CompanionTtsVoice, string> = {
  eugene: 'Евгений',
  aidar: 'Айдар',
  xenia: 'Ксения',
  baya: 'Бая',
  kseniya: 'Ксения (Silero)'
}

const TTS_VOICE_OPTIONS: CompanionTtsVoice[] = ['eugene', 'aidar', 'xenia', 'baya', 'kseniya']

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
  if (status.status === 'downloading') {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('auto.components.settings.CompanionPane.tts.downloading', 'Загрузка голоса…')}{' '}
        {status.progress !== undefined ? `${Math.round(status.progress)}%` : ''}
      </p>
    )
  }
  if (status.status === 'error') {
    return (
      <p className="text-xs text-destructive">
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
      {translate('auto.components.settings.CompanionPane.tts.ready', 'Голос готов.')}
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
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.ttsEnable', 'Озвучивать ответы')}
          </Label>
          <TtsProvisioningRow status={ttsProvisioningStatus} />
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

      <div className="flex items-center justify-between gap-4 py-2">
        <Label>{translate('auto.components.settings.CompanionPane.ttsVoice', 'Голос')}</Label>
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

      <div className="space-y-1.5 py-2">
        <div className="flex items-center justify-between gap-4">
          <Label>
            {translate('auto.components.settings.CompanionPane.ttsRate', 'Скорость озвучки')}
          </Label>
          <span className="text-xs text-muted-foreground">
            {companionSettings.tts.ttsRate.toFixed(2)}×
          </span>
        </div>
        <Slider
          min={0.5}
          max={2}
          step={0.05}
          value={[companionSettings.tts.ttsRate]}
          onValueChange={([value]) => updateTtsSettings({ ttsRate: value })}
        />
      </div>

      <Separator />

      <CompanionYandexTtsSettingsSection
        companionSettings={companionSettings}
        updateTtsSettings={updateTtsSettings}
      />
    </>
  )
}
