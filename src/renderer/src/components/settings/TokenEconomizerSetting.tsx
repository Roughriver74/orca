import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TokenEconomizerStatus } from '../../../../shared/token-economizer-status'
import { SearchableSetting } from './SearchableSetting'
import { SettingsSwitchRow } from './SettingsFormControls'
import {
  getTokenEconomizerDescription,
  getTokenEconomizerSearchKeywords,
  getTokenEconomizerStatusLine,
  getTokenEconomizerTitle
} from './token-economizer-copy'

type TokenEconomizerSettingProps = {
  settings: GlobalSettings
  updateSettings: (updates: Partial<GlobalSettings>) => void | Promise<void>
}

function useTokenEconomizerStatus(): TokenEconomizerStatus {
  const [status, setStatus] = useState<TokenEconomizerStatus>({ state: 'off' })
  useEffect(() => {
    let mounted = true
    const unsubscribe = window.api.tokenEconomizer.onChanged(setStatus)
    void window.api.tokenEconomizer
      .getStatus()
      .then((current) => mounted && setStatus(current))
      .catch(() => undefined)
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])
  return status
}

export function TokenEconomizerSetting({
  settings,
  updateSettings
}: TokenEconomizerSettingProps): React.JSX.Element {
  const title = getTokenEconomizerTitle()
  const description = getTokenEconomizerDescription()
  const enabled = settings.tokenEconomizerEnabled === true
  const status = useTokenEconomizerStatus()
  const statusLine = enabled ? getTokenEconomizerStatusLine(status) : null
  return (
    <section className="space-y-3">
      <SearchableSetting
        title={title}
        description={description}
        keywords={getTokenEconomizerSearchKeywords()}
      >
        <SettingsSwitchRow
          label={title}
          description={
            <>
              {description}
              {statusLine ? (
                <span
                  className={cn(
                    'mt-1 block',
                    (status.state === 'error' || status.state === 'python_missing') &&
                      'text-destructive'
                  )}
                >
                  {statusLine}
                </span>
              ) : null}
            </>
          }
          checked={enabled}
          onChange={() => void updateSettings({ tokenEconomizerEnabled: !enabled })}
        />
      </SearchableSetting>
    </section>
  )
}
