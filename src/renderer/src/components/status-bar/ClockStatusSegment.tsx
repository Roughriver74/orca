import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  formatStatusBarClockLabel,
  formatStatusBarClockTooltip,
  getMsUntilNextMinuteBoundary
} from './status-bar-clock-format'

/** Status bar date/time. Kept in its own component with its own timer so a
 *  once-a-minute tick never re-renders the rest of the (otherwise static)
 *  status bar. */
export function ClockStatusSegment(): React.JSX.Element {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>

    // Why: align to the minute boundary instead of a naive 60s interval so the
    // displayed minute never drifts from the wall clock.
    const scheduleNextTick = (): void => {
      timeoutId = setTimeout(() => {
        setNow(new Date())
        scheduleNextTick()
      }, getMsUntilNextMinuteBoundary(new Date()))
    }
    scheduleNextTick()

    // Why: a sleeping/backgrounded laptop pauses timers; refresh immediately on
    // wake/focus so the clock doesn't show a stale time, then re-align.
    const refreshNow = (): void => {
      setNow(new Date())
      clearTimeout(timeoutId)
      scheduleNextTick()
    }
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') {
        refreshNow()
      }
    }
    window.addEventListener('focus', refreshNow)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('focus', refreshNow)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Why: the clock follows the OS region (24h, month names), not Orca's UI language.
  const locale = [...navigator.languages]

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-status-bar-clock
          className="truncate tabular-nums text-muted-foreground select-none"
        >
          {formatStatusBarClockLabel(now, locale)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        {formatStatusBarClockTooltip(now, locale)}
      </TooltipContent>
    </Tooltip>
  )
}
