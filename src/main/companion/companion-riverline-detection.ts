// Backlog #28: Riverline's menu-bar notch already shows Jarvis state (via `orca companion
// status`) on macOS, so Orca's own pill indicator (companion-indicator-window.ts) must stay
// hidden whenever Riverline is running — otherwise the user gets two redundant status widgets.
// Linux has no Riverline at all, so the pill is the only indicator there and always applies.
//
// The policy (`decideRiverlineRunning`) is a pure function over a bundle-id list so it is
// testable without ever shelling out; `createCompanionRiverlineWatcher` is the thin periodic
// poller that feeds it real data in production.

import { execFile } from 'node:child_process'

/** Riverline's macOS app bundle identifier. */
export const RIVERLINE_BUNDLE_ID = 'com.roughriver74.riverline'

/** Re-checked periodically (not just once at startup): the user can launch/quit Riverline
 *  at any time while Orca keeps running. */
export const RIVERLINE_DETECTION_INTERVAL_MS = 10_000

/** Pure policy: non-macOS platforms never have Riverline, so the pill always applies there;
 *  macOS checks the live running-application bundle ids. */
export function decideRiverlineRunning(
  platform: NodeJS.Platform,
  runningBundleIds: readonly string[]
): boolean {
  if (platform !== 'darwin') {
    return false
  }
  return runningBundleIds.includes(RIVERLINE_BUNDLE_ID)
}

/** Lists running app bundle identifiers via System Events — the same primitive `lsappinfo`/
 *  Activity Monitor rely on, with no extra native dependency. Resolves to `[]` (not running
 *  Riverline, fails open to "show the pill") on any error — e.g. System Events unavailable in
 *  a locked-down/background launch — since a false "Riverline is running" would hide the only
 *  indicator the user has. */
function listRunningBundleIdsOnDarwin(): Promise<string[]> {
  // Why: e2e specs (and any dev machine with the real Riverline app already running, like this
  // repo's own) need a deterministic "Riverline absent" result to exercise the pill-visible
  // path without quitting the developer's real app or faking System Events output.
  if (process.env.ORCA_E2E_RIVERLINE_ABSENT === '1') {
    return Promise.resolve([])
  }
  const { promise, resolve } = Promise.withResolvers<string[]>()
  execFile(
    'osascript',
    ['-e', 'tell application "System Events" to get bundle identifier of every process'],
    { timeout: 5_000 },
    (error, stdout) => {
      if (error) {
        resolve([])
        return
      }
      resolve(
        stdout
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== '')
      )
    }
  )
  return promise
}

export type CompanionRiverlineWatcherDeps = {
  platform: NodeJS.Platform
  /** Swappable for tests; production default shells out to System Events on macOS. */
  listRunningBundleIds?: () => Promise<string[]>
  intervalMs?: number
}
/** Starts polling and calls `onChange` once immediately and again every time the running/not
 *  state flips (not on every poll tick, so a listener wiring window show/hide doesn't thrash).
 *  Returns a disposer. */
export function createCompanionRiverlineWatcher(deps: CompanionRiverlineWatcherDeps): {
  start: (onChange: (running: boolean) => void) => () => void
} {
  const platform = deps.platform
  const listRunningBundleIds =
    deps.listRunningBundleIds ??
    (platform === 'darwin' ? listRunningBundleIdsOnDarwin : async () => [])
  const intervalMs = deps.intervalMs ?? RIVERLINE_DETECTION_INTERVAL_MS

  return {
    start(onChange) {
      let lastKnown: boolean | null = null
      let disposed = false

      const check = async (): Promise<void> => {
        const bundleIds = await listRunningBundleIds()
        if (disposed) {
          return
        }
        const running = decideRiverlineRunning(platform, bundleIds)
        if (running !== lastKnown) {
          lastKnown = running
          onChange(running)
        }
      }

      void check()
      const timer = setInterval(() => void check(), intervalMs)
      return () => {
        disposed = true
        clearInterval(timer)
      }
    }
  }
}
