// Why: isolate Intl formatting + minute-boundary scheduling from the clock
// component so both are unit-testable without mounting React or faking timers.

/** Compact label shown in the status bar, e.g. "вс, 11 окт., 20:36" (ru-RU) or "Sun, Oct 11, 8:36 PM" (en-US). */
export function formatStatusBarClockLabel(date: Date, locale: string | string[]): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/** Full date shown in the tooltip, e.g. "Sunday, October 11, 2026, 8:36 PM". */
export function formatStatusBarClockTooltip(date: Date, locale: string | string[]): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

/** Milliseconds until the next minute boundary (clamped to [1, 60000]) so a
 *  single timer can re-align itself instead of drifting via setInterval. */
export function getMsUntilNextMinuteBoundary(date: Date): number {
  const msIntoMinute = date.getSeconds() * 1000 + date.getMilliseconds()
  const remaining = 60_000 - msIntoMinute
  return remaining <= 0 ? 60_000 : remaining
}
