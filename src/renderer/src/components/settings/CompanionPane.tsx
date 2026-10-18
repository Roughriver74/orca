import { useCallback, useEffect, useState } from 'react'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type {
  CompanionSettings,
  CompanionTtsProvisioningStatus
} from '../../../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../../../shared/constants'
import type { SpeechModelManifest, SpeechModelState } from '../../../../shared/speech-types'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Input } from '../ui/input'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { CompanionBrainSettingsSection } from './CompanionBrainSettingsSection'
import { CompanionTtsSettingsSection } from './CompanionTtsSettingsSection'
import { CompanionVoiceInteractionSettingsSection } from './CompanionVoiceInteractionSettingsSection'

type CompanionPaneProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void
}

function HotkeyStatusRow({
  status
}: {
  status: { registered: boolean; error: string | null } | null
}): React.JSX.Element | null {
  if (!status?.error) {
    return null
  }
  return <p className="text-xs text-destructive">{status.error}</p>
}

export function CompanionPane({ settings, updateSettings }: CompanionPaneProps): React.JSX.Element {
  const [defaultCompanionSettings] = useState(getDefaultCompanionSettings)
  const companionSettings = settings.companion ?? defaultCompanionSettings
  const modelStates = useAppStore((s) => s.modelStates)
  const [catalog, setCatalog] = useState<SpeechModelManifest[]>([])
  const [hotkeyDraft, setHotkeyDraft] = useState(companionSettings.hotkey)
  const [hotkeyStatus, setHotkeyStatus] = useState<{
    registered: boolean
    error: string | null
  } | null>(null)
  const [ttsProvisioningStatus, setTtsProvisioningStatus] =
    useState<CompanionTtsProvisioningStatus | null>(null)

  useEffect(() => {
    setHotkeyDraft(companionSettings.hotkey)
  }, [companionSettings.hotkey])

  useEffect(() => {
    void window.api.speech.getCatalog().then(setCatalog)
  }, [])

  useEffect(() => {
    let disposed = false
    void window.api.companion.getHotkeyStatus().then((status) => {
      if (!disposed) {
        setHotkeyStatus(status)
      }
    })
    return () => {
      disposed = true
    }
  }, [companionSettings.enabled, companionSettings.hotkey])

  useEffect(() => {
    return window.api.companion.onTtsProvisioningStatus(setTtsProvisioningStatus)
  }, [])

  const updateCompanionSettings = useCallback(
    (updates: Partial<CompanionSettings>): void => {
      updateSettings({ companion: { ...companionSettings, ...updates } })
    },
    [companionSettings, updateSettings]
  )

  const updateTtsSettings = useCallback(
    (updates: Partial<CompanionSettings['tts']>): void => {
      updateCompanionSettings({ tts: { ...companionSettings.tts, ...updates } })
    },
    [companionSettings.tts, updateCompanionSettings]
  )

  const updateNotifySettings = useCallback(
    (updates: Partial<CompanionSettings['notify']>): void => {
      updateCompanionSettings({ notify: { ...companionSettings.notify, ...updates } })
    },
    [companionSettings.notify, updateCompanionSettings]
  )

  const readyModels = catalog.filter((model) =>
    modelStates.some((state: SpeechModelState) => state.id === model.id && state.status === 'ready')
  )

  const commitHotkey = (): void => {
    const trimmed = hotkeyDraft.trim()
    if (trimmed === '' || trimmed === companionSettings.hotkey) {
      setHotkeyDraft(companionSettings.hotkey)
      return
    }
    updateCompanionSettings({ hotkey: trimmed })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.enable', 'Включить Джарвиса')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.enableDescription',
              'Голосовой помощник по горячей клавише, работает поверх всех приложений.'
            )}
          </p>
        </div>
        <Switch
          checked={companionSettings.enabled}
          onCheckedChange={(checked) => updateCompanionSettings({ enabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.enable',
            'Включить Джарвиса'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="companion-hotkey">
            {translate('auto.components.settings.CompanionPane.hotkey', 'Горячая клавиша')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.hotkeyDescription',
              'Например: Alt+Space или Control+J.'
            )}
          </p>
          <HotkeyStatusRow status={hotkeyStatus} />
        </div>
        <Input
          id="companion-hotkey"
          className="w-40 shrink-0"
          value={hotkeyDraft}
          onChange={(event) => setHotkeyDraft(event.target.value)}
          onBlur={commitHotkey}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.sttModel', 'Модель распознавания')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.sttModelDescription',
              'Только уже установленные модели. Загрузите модель на вкладке Voice.'
            )}
          </p>
        </div>
        <Select
          value={companionSettings.sttModel}
          onValueChange={(value) => updateCompanionSettings({ sttModel: value })}
        >
          <SelectTrigger className="w-48 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {readyModels.length === 0 ? (
              <SelectItem value={companionSettings.sttModel}>
                {companionSettings.sttModel}
              </SelectItem>
            ) : (
              readyModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="space-y-1.5 py-2">
        <div className="flex items-center justify-between gap-4">
          <Label>
            {translate(
              'auto.components.settings.CompanionPane.endOfUtterance',
              'Пауза перед завершением фразы'
            )}
          </Label>
          <span className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.endOfUtteranceSeconds',
              '{{seconds}} с',
              { seconds: companionSettings.endOfUtteranceSeconds.toFixed(1) }
            )}
          </span>
        </div>
        <Slider
          min={1}
          max={5}
          step={0.1}
          value={[companionSettings.endOfUtteranceSeconds]}
          onValueChange={([value]) => updateCompanionSettings({ endOfUtteranceSeconds: value })}
        />
      </div>

      <Separator />

      <CompanionTtsSettingsSection
        companionSettings={companionSettings}
        updateTtsSettings={updateTtsSettings}
        ttsProvisioningStatus={ttsProvisioningStatus}
      />

      <Separator />

      <CompanionVoiceInteractionSettingsSection
        companionSettings={companionSettings}
        updateCompanionSettings={updateCompanionSettings}
      />

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.CompanionPane.notifyEnable',
              'Уведомлять о других агентах'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.notifyEnableDescription',
              'Тихое уведомление, когда агент закончил работу или ждёт решения.'
            )}
          </p>
        </div>
        <Switch
          checked={companionSettings.notify.enabled}
          onCheckedChange={(checked) => updateNotifySettings({ enabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.notifyEnable',
            'Уведомлять о других агентах'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="companion-notify-quiet-from">
            {translate('auto.components.settings.CompanionPane.notifyQuietHours', 'Тихие часы')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.notifyQuietHoursDescription',
              'Уведомления копятся и приходят после окончания тихих часов.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            id="companion-notify-quiet-from"
            type="time"
            className="w-28"
            value={companionSettings.notify.quietFrom}
            onChange={(event) => updateNotifySettings({ quietFrom: event.target.value })}
          />
          <span className="text-xs text-muted-foreground">
            {translate('auto.components.settings.CompanionPane.notifyQuietHoursTo', 'до')}
          </span>
          <Input
            type="time"
            className="w-28"
            value={companionSettings.notify.quietTo}
            onChange={(event) => updateNotifySettings({ quietTo: event.target.value })}
          />
        </div>
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.CompanionPane.notifySpeak',
              'Озвучивать уведомления'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.notifySpeakDescription',
              'Проговаривать уведомление вслух, а не только показывать текст.'
            )}
          </p>
        </div>
        <Switch
          checked={companionSettings.notify.speak}
          onCheckedChange={(checked) => updateNotifySettings({ speak: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.notifySpeak',
            'Озвучивать уведомления'
          )}
        />
      </div>

      <Separator />

      <CompanionBrainSettingsSection
        companionSettings={companionSettings}
        updateCompanionSettings={updateCompanionSettings}
      />
    </div>
  )
}
