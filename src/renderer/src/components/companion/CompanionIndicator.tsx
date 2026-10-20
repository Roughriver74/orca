import { useEffect, useState } from 'react'
import { Loader2, Mic, Volume2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { CompanionConversationState } from '../../../../shared/companion-types'

/**
 * Renderer for the tiny always-on-top pill (main process owns show/hide via
 * companion-indicator-lifecycle.ts). Click-through by default — `onMouseEnter`/
 * `onMouseLeave` report real hover over the visible shape so main can toggle
 * `BrowserWindow.setIgnoreMouseEvents` just long enough for the click to land.
 */
export function CompanionIndicator(): React.JSX.Element | null {
  const [state, setState] = useState<CompanionConversationState>('listening')

  useEffect(() => {
    // Why hydrate: the window can already be visible (another `stateChanged` push
    // raced it) by the time this effect subscribes, so read the current value once.
    void window.api.companion.getConversationState().then(setState)
    return window.api.companion.onStateChanged(setState)
  }, [])

  const stateLabel =
    state === 'thinking'
      ? translate('companion.indicator.thinking', 'Думаю')
      : state === 'speaking'
        ? translate('companion.indicator.speaking', 'Говорю')
        : translate('companion.indicator.listening', 'Слушаю')
  const StateIcon = state === 'thinking' ? Loader2 : state === 'speaking' ? Volume2 : Mic

  if (state === 'idle') {
    return null
  }

  return (
    <div
      className="flex size-full select-none items-center justify-center gap-1.5 rounded-full border border-white/10 bg-black/80 px-3 text-xs font-medium text-white shadow-lg backdrop-blur-xl"
      onMouseEnter={() => void window.api.companion.reportIndicatorHover(true)}
      onMouseLeave={() => void window.api.companion.reportIndicatorHover(false)}
      onClick={() => void window.api.companion.toggle()}
    >
      <StateIcon className={cn('size-3 shrink-0', state === 'thinking' && 'animate-spin')} />
      <span className="truncate">{stateLabel}</span>
    </div>
  )
}
