import { useEffect, useState } from 'react'
import type { CompanionSettings } from '../../../../shared/companion-types'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Slider } from '../ui/slider'
import { Switch } from '../ui/switch'
import { translate } from '@/i18n/i18n'

type CompanionEndKeywordSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateCompanionSettings: (updates: Partial<CompanionSettings>) => void
}

function parseWords(draft: string): string[] {
  return draft
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word !== '')
}

/** "Слово-сигнал": hold the dictated request until it ends on a keyword (or a long pause). */
export function CompanionEndKeywordSettingsSection({
  companionSettings,
  updateCompanionSettings
}: CompanionEndKeywordSettingsSectionProps): React.JSX.Element {
  const { endKeyword } = companionSettings
  const updateEndKeywordSettings = (updates: Partial<CompanionSettings['endKeyword']>): void => {
    updateCompanionSettings({ endKeyword: { ...endKeyword, ...updates } })
  }
  const savedWords = endKeyword.words.join(', ')
  const [wordsDraft, setWordsDraft] = useState(savedWords)

  useEffect(() => {
    setWordsDraft(savedWords)
  }, [savedWords])

  const commitWords = (): void => {
    const words = parseWords(wordsDraft)
    if (words.length === 0 || words.join(', ') === savedWords) {
      setWordsDraft(savedWords)
      return
    }
    updateEndKeywordSettings({ words })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.endKeywordEnable', 'Слово-сигнал')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.endKeywordEnableDescription',
              'Паузы не обрывают реплику: всё сказанное копится, пока вы не закончите словом-сигналом. Само слово Джарвису не отправляется. Горячая клавиша отправляет сразу.'
            )}
          </p>
        </div>
        <Switch
          checked={endKeyword.enabled}
          onCheckedChange={(checked) => updateEndKeywordSettings({ enabled: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.endKeywordEnable',
            'Слово-сигнал'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label htmlFor="companion-end-keyword-words">
            {translate('auto.components.settings.CompanionPane.endKeywordWords', 'Слова-сигналы')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.endKeywordWordsDescription',
              'Через запятую. Срабатывают, только когда стоят последними в реплике.'
            )}
          </p>
        </div>
        <Input
          id="companion-end-keyword-words"
          className="w-48 shrink-0"
          value={wordsDraft}
          disabled={!endKeyword.enabled}
          onChange={(event) => setWordsDraft(event.target.value)}
          onBlur={commitWords}
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
                'auto.components.settings.CompanionPane.endKeywordFallbackPause',
                'Отправить без слова после паузы'
              )}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionPane.endKeywordFallbackPauseDescription',
                'Если слово-сигнал не прозвучало — сколько молчать после последней фразы, чтобы реплика ушла сама.'
              )}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.endOfUtteranceSeconds',
              '{{seconds}} с',
              { seconds: endKeyword.fallbackPauseSeconds.toFixed(1) }
            )}
          </span>
        </div>
        <Slider
          min={1}
          max={30}
          step={0.5}
          disabled={!endKeyword.enabled}
          value={[endKeyword.fallbackPauseSeconds]}
          onValueChange={([value]) => updateEndKeywordSettings({ fallbackPauseSeconds: value })}
        />
      </div>
    </>
  )
}
