import { useEffect, useState } from 'react'
import type { CompanionSettings } from '../../../../shared/companion-types'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { translate } from '@/i18n/i18n'

type CompanionVoiceInteractionSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateCompanionSettings: (updates: Partial<CompanionSettings>) => void
}

function parsePhrases(draft: string): string[] {
  return draft
    .split(',')
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase !== '')
}

/** How the user talks to Jarvis beyond the hotkey: voice barge-in, wake-phrase listening
 *  (enable, phrases, follow-up window), and where Latin-word pronunciations live. */
export function CompanionVoiceInteractionSettingsSection({
  companionSettings,
  updateCompanionSettings
}: CompanionVoiceInteractionSettingsSectionProps): React.JSX.Element {
  const { wake } = companionSettings
  const updateWakeSettings = (updates: Partial<CompanionSettings['wake']>): void => {
    updateCompanionSettings({ wake: { ...wake, ...updates } })
  }
  const savedPhrases = wake.phrases.join(', ')
  const [phrasesDraft, setPhrasesDraft] = useState(savedPhrases)

  useEffect(() => {
    setPhrasesDraft(savedPhrases)
  }, [savedPhrases])

  const commitPhrases = (): void => {
    const phrases = parsePhrases(phrasesDraft)
    if (phrases.length === 0 || phrases.join(', ') === savedPhrases) {
      setPhrasesDraft(savedPhrases)
      return
    }
    updateWakeSettings({ phrases })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.voiceBargeIn', 'Перебивать голосом')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.voiceBargeInDescription',
              'Начните говорить во время ответа — Джарвис замолчит и выслушает. Собственный голос из колонок он отличает по громкости относительно своей речи.'
            )}
          </p>
        </div>
        <Switch
          checked={companionSettings.voiceBargeIn}
          disabled={!companionSettings.tts.ttsEnabled}
          onCheckedChange={(checked) => updateCompanionSettings({ voiceBargeIn: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.voiceBargeIn',
            'Перебивать голосом'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate(
              'auto.components.settings.CompanionPane.wakeEnable',
              'Слушать всегда, отвечать по обращению'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.wakeEnableDescription',
              'Микрофон включён постоянно, но Джарвис отвечает, только когда к нему обратились по имени. Телевизор и чужие разговоры игнорируются и никуда не отправляются.'
            )}
          </p>
        </div>
        <Switch
          checked={wake.enabled}
          onCheckedChange={(checked) => updateWakeSettings({ enabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.wakeEnable',
            'Слушать всегда, отвечать по обращению'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="companion-wake-phrases">
            {translate('auto.components.settings.CompanionPane.wakePhrases', 'Обращение')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.wakePhrasesDescription',
              'Имя или фраза через запятую, например: Джарвис, Пятница.'
            )}
          </p>
        </div>
        <Input
          id="companion-wake-phrases"
          className="w-48 shrink-0"
          value={phrasesDraft}
          disabled={!wake.enabled}
          onChange={(event) => setPhrasesDraft(event.target.value)}
          onBlur={commitPhrases}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
          }}
        />
      </div>

      <Separator />

      <div className="space-y-1.5 py-2">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label>
              {translate(
                'auto.components.settings.CompanionPane.wakeFollowUp',
                'Продолжение без имени'
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionPane.wakeFollowUpDescription',
                'Сколько ждать следующей реплики после ответа, не требуя обращения. 0 — всегда по имени.'
              )}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.endOfUtteranceSeconds',
              '{{seconds}} с',
              {
                seconds: (wake.followUpMs / 1000).toFixed(0)
              }
            )}
          </span>
        </div>
        <Slider
          min={0}
          max={30_000}
          step={1000}
          disabled={!wake.enabled}
          value={[wake.followUpMs]}
          onValueChange={([value]) => updateWakeSettings({ followUpMs: value })}
        />
      </div>

      <Separator />

      <p className="py-2 text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.CompanionPane.ttsPronunciations',
          'Английские слова читаются по словарю: добавьте строки «слово = как читать» в файл tts-pronunciations.txt в папке Джарвиса.'
        )}
      </p>
    </>
  )
}
