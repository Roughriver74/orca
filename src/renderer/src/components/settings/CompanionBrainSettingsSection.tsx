import { toast } from 'sonner'
import type { CompanionBrainModel, CompanionSettings } from '../../../../shared/companion-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Switch } from '../ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { translate } from '@/i18n/i18n'

const BRAIN_MODEL_LABELS: Record<CompanionBrainModel, string> = {
  sonnet: 'Sonnet',
  opus: 'Opus',
  haiku: 'Haiku'
}

const BRAIN_MODEL_OPTIONS: CompanionBrainModel[] = ['sonnet', 'opus', 'haiku']

function isCompanionBrainModel(value: string): value is CompanionBrainModel {
  switch (value) {
    case 'sonnet':
    case 'opus':
    case 'haiku':
      return true
    default:
      return false
  }
}

type CompanionBrainSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateCompanionSettings: (updates: Partial<CompanionSettings>) => void
}

/** The companion's brain model, launch-at-login, and "New conversation" rows — split
 *  out of `CompanionPane` to keep that file under the repo's per-file line cap. */
export function CompanionBrainSettingsSection({
  companionSettings,
  updateCompanionSettings
}: CompanionBrainSettingsSectionProps): React.JSX.Element {
  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.brainModel', 'Модель мозга')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.brainModelDescription',
              'Какая модель Claude ведёт разговор.'
            )}
          </p>
        </div>
        <Select
          value={companionSettings.brainModel}
          onValueChange={(value) => {
            if (isCompanionBrainModel(value)) {
              updateCompanionSettings({ brainModel: value })
            }
          }}
        >
          <SelectTrigger className="w-40 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BRAIN_MODEL_OPTIONS.map((model) => (
              <SelectItem key={model} value={model}>
                {BRAIN_MODEL_LABELS[model]}
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
              'auto.components.settings.CompanionPane.launchAtLogin',
              'Запускать при входе в систему'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.launchAtLoginDescription',
              'Orca откроется в фоне при входе в macOS, чтобы Джарвис был готов сразу.'
            )}
          </p>
        </div>
        <Switch
          checked={companionSettings.launchAtLogin}
          onCheckedChange={(checked) => updateCompanionSettings({ launchAtLogin: checked })}
          aria-label={translate(
            'auto.components.settings.CompanionPane.launchAtLogin',
            'Запускать при входе в систему'
          )}
        />
      </div>

      <Separator />

      <div className="flex items-center justify-between gap-4 py-2">
        <div className="space-y-0.5">
          <Label>
            {translate('auto.components.settings.CompanionPane.newConversation', 'Новый разговор')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.CompanionPane.newConversationDescription',
              'Забыть текущий разговор с Джарвисом и начать с чистого листа.'
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void window.api.companion.resetConversation()
            toast.success(
              translate(
                'auto.components.settings.CompanionPane.newConversationStarted',
                'Разговор сброшен'
              )
            )
          }}
        >
          {translate('auto.components.settings.CompanionPane.newConversation', 'Новый разговор')}
        </Button>
      </div>
    </>
  )
}
