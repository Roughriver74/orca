import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  CompanionSettings,
  CompanionTtsUsageSnapshot,
  CompanionYandexVoice
} from '../../../../shared/companion-types'
import { YANDEX_VOICE_LABELS, YANDEX_VOICE_MIN_API } from '../../../../shared/companion-types'
import type { SecretAtRestProtection } from '../../../../shared/secret-at-rest-protection'
import { Label } from '../ui/label'
import { Separator } from '../ui/separator'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Slider } from '../ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { translate } from '@/i18n/i18n'
import { UnsealedCredentialNotice } from './UnsealedCredentialNotice'

const YANDEX_VOICE_OPTIONS: CompanionYandexVoice[] = [
  'filipp',
  'ermil',
  'zahar',
  'alexander',
  'kirill',
  'anton',
  'madirus'
]

function isCompanionYandexVoice(value: string): value is CompanionYandexVoice {
  return YANDEX_VOICE_OPTIONS.some((voice) => voice === value)
}

function formatRub(value: number): string {
  return `${value.toFixed(2)} ₽`
}

type CompanionYandexTtsSettingsSectionProps = {
  companionSettings: CompanionSettings
  updateTtsSettings: (updates: Partial<CompanionSettings['tts']>) => void
  /** Qwen3 runs on MLX (Apple Silicon only); elsewhere the option is not offered. */
  qwen3Supported: boolean
}

/** Provider toggle plus every Yandex-specific knob (voice, spoken-text cap, monthly
 *  budget, API key, usage) — split out of `CompanionTtsSettingsSection` so the Silero
 *  rows there stay a one-line insertion away from this file's churn. */
export function CompanionYandexTtsSettingsSection({
  companionSettings,
  updateTtsSettings,
  qwen3Supported
}: CompanionYandexTtsSettingsSectionProps): React.JSX.Element {
  const [keyStatus, setKeyStatus] = useState<{
    configured: boolean
    protection: SecretAtRestProtection | null
  } | null>(null)
  const [keyDraft, setKeyDraft] = useState('')
  const [keyPending, setKeyPending] = useState(false)
  const [testPending, setTestPending] = useState(false)
  const [usage, setUsage] = useState<CompanionTtsUsageSnapshot | null>(null)

  const refreshKeyStatus = useCallback(() => {
    void window.api.companionTts.getYandexKeyStatus().then(setKeyStatus)
  }, [])
  const refreshUsage = useCallback(() => {
    void window.api.companionTts.getUsage().then(setUsage)
  }, [])

  useEffect(() => {
    refreshKeyStatus()
    refreshUsage()
  }, [refreshKeyStatus, refreshUsage])

  const isYandex = companionSettings.tts.provider === 'yandex'
  // A `qwen3` value where Qwen3 cannot run (e.g. settings from a Mac) speaks with Silero.
  const shownProvider =
    companionSettings.tts.provider === 'qwen3' && !qwen3Supported
      ? 'silero'
      : companionSettings.tts.provider

  const saveKey = async (): Promise<void> => {
    setKeyPending(true)
    try {
      const status = await window.api.companionTts.saveYandexApiKey(keyDraft)
      setKeyStatus(status)
      setKeyDraft('')
      toast.success(
        translate('auto.components.settings.CompanionYandexTts.keySaved', 'Ключ сохранён')
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setKeyPending(false)
    }
  }

  const clearKey = async (): Promise<void> => {
    setKeyPending(true)
    try {
      setKeyStatus(await window.api.companionTts.clearYandexApiKey())
      toast.success(
        translate('auto.components.settings.CompanionYandexTts.keyCleared', 'Ключ удалён')
      )
    } finally {
      setKeyPending(false)
    }
  }

  const testKey = async (): Promise<void> => {
    setTestPending(true)
    try {
      const result = await window.api.companionTts.testYandexApiKey()
      if (result.ok) {
        toast.success(
          translate(
            'auto.components.settings.CompanionYandexTts.testOk',
            'Яндекс SpeechKit работает'
          )
        )
      } else {
        toast.error(
          result.message ??
            translate(
              'auto.components.settings.CompanionYandexTts.testFailed',
              'Проверка не удалась'
            )
        )
      }
      refreshUsage()
    } finally {
      setTestPending(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-2">
        <Label>
          {translate('auto.components.settings.CompanionYandexTts.provider', 'Озвучка')}
        </Label>
        <Select
          value={shownProvider}
          onValueChange={(value) => {
            if (value === 'silero' || value === 'yandex' || value === 'qwen3') {
              updateTtsSettings({ provider: value })
            }
          }}
        >
          <SelectTrigger className="w-56 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="silero">
              {translate(
                'auto.components.settings.CompanionYandexTts.providerSilero',
                'Silero (локально, бесплатно)'
              )}
            </SelectItem>
            {qwen3Supported ? (
              <SelectItem value="qwen3">
                {translate(
                  'auto.components.settings.CompanionYandexTts.providerQwen3',
                  'Qwen3-TTS (локально, с эмоциями, ~3 ГБ)'
                )}
              </SelectItem>
            ) : null}
            <SelectItem value="yandex">
              {translate(
                'auto.components.settings.CompanionYandexTts.providerYandex',
                'Яндекс SpeechKit (облако, платно)'
              )}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!isYandex ? null : (
        <>
          <Separator />
          <div className="flex items-center justify-between gap-4 py-2">
            <Label>
              {translate('auto.components.settings.CompanionYandexTts.voice', 'Голос Яндекса')}
            </Label>
            <Select
              value={companionSettings.tts.yandexVoice}
              onValueChange={(value) => {
                if (isCompanionYandexVoice(value)) {
                  updateTtsSettings({ yandexVoice: value })
                }
              }}
            >
              <SelectTrigger className="w-56 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YANDEX_VOICE_OPTIONS.map((voice) => (
                  <SelectItem key={voice} value={voice}>
                    {YANDEX_VOICE_LABELS[voice]}
                    {YANDEX_VOICE_MIN_API[voice] === 'v3' ? ' (v3)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />
          <div className="space-y-1.5 py-2">
            <div className="flex items-center justify-between gap-4">
              <Label>
                {translate(
                  'auto.components.settings.CompanionYandexTts.maxSpokenChars',
                  'Сколько озвучивать вслух'
                )}
              </Label>
              <span className="text-xs text-muted-foreground">
                {translate(
                  'auto.components.settings.CompanionYandexTts.maxSpokenCharsValue',
                  '{{chars}} симв.',
                  { chars: companionSettings.tts.maxSpokenChars }
                )}
              </span>
            </div>
            <Slider
              min={60}
              max={1000}
              step={10}
              value={[companionSettings.tts.maxSpokenChars]}
              onValueChange={([value]) => updateTtsSettings({ maxSpokenChars: value })}
            />
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionYandexTts.maxSpokenCharsHint',
                'Остальной ответ всё равно виден в панели текстом — голосом экономим на символах.'
              )}
            </p>
          </div>

          <Separator />
          <div className="space-y-1.5 py-2">
            <div className="flex items-center justify-between gap-4">
              <Label>
                {translate(
                  'auto.components.settings.CompanionYandexTts.budget',
                  'Бюджет на озвучку в месяц'
                )}
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  className="w-24"
                  value={companionSettings.tts.yandexMonthlyBudgetRub}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) {
                      updateTtsSettings({ yandexMonthlyBudgetRub: value })
                    }
                  }}
                />
                <span className="text-xs text-muted-foreground">₽</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'auto.components.settings.CompanionYandexTts.budgetHint',
                'При достижении бюджета за 30 дней Джарвис автоматически переходит на Silero до конца периода.'
              )}
            </p>
          </div>

          <Separator />
          <div className="space-y-1.5 py-2">
            <Label>
              {translate(
                'auto.components.settings.CompanionYandexTts.apiKey',
                'Ключ API Яндекс SpeechKit'
              )}
            </Label>
            <UnsealedCredentialNotice
              protection={keyStatus?.protection ?? null}
              credentialName={translate(
                'auto.components.settings.CompanionYandexTts.apiKey',
                'Ключ API Яндекс SpeechKit'
              )}
            />
            {keyStatus?.configured ? (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {translate(
                    'auto.components.settings.CompanionYandexTts.keyConfigured',
                    'Ключ сохранён'
                  )}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={testPending}
                  onClick={() => void testKey()}
                >
                  {translate('auto.components.settings.CompanionYandexTts.test', 'Проверить')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={keyPending}
                  onClick={() => void clearKey()}
                >
                  {translate('auto.components.settings.CompanionYandexTts.clear', 'Удалить')}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Input
                  type="password"
                  placeholder="AQVN..."
                  value={keyDraft}
                  onChange={(event) => setKeyDraft(event.target.value)}
                  className="w-56"
                />
                <Button
                  size="sm"
                  disabled={keyPending || keyDraft.trim() === ''}
                  onClick={() => void saveKey()}
                >
                  {translate('auto.components.settings.CompanionYandexTts.save', 'Сохранить')}
                </Button>
              </div>
            )}
          </div>

          {usage ? (
            <>
              <Separator />
              <div className="space-y-1 py-2 text-xs text-muted-foreground">
                <p>
                  {translate(
                    'auto.components.settings.CompanionYandexTts.usageToday',
                    'Сегодня: {{chars}} симв. ≈ {{cost}} · запросов: {{requests}}',
                    {
                      chars: usage.today.characters,
                      cost: formatRub(usage.today.costRub),
                      requests: usage.today.requests
                    }
                  )}
                </p>
                <p>
                  {translate(
                    'auto.components.settings.CompanionYandexTts.usage30d',
                    'За 30 дней: {{chars}} симв. ≈ {{cost}} · сэкономлено кэшем: {{saved}}',
                    {
                      chars: usage.last30Days.characters,
                      cost: formatRub(usage.last30Days.costRub),
                      saved: formatRub(usage.last30Days.cacheHitSavingsRub)
                    }
                  )}
                </p>
                {usage.budgetExceeded ? (
                  <p className="text-status-warning">
                    {translate(
                      'auto.components.settings.CompanionYandexTts.budgetExceeded',
                      'Бюджет на этот месяц исчерпан — Джарвис временно говорит голосом Silero.'
                    )}
                  </p>
                ) : null}
                <p>
                  {translate(
                    'auto.components.settings.CompanionYandexTts.pricesApproximate',
                    'Цены приблизительные — официальная страница тарифов Яндекса недоступна напрямую.'
                  )}
                </p>
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  )
}
