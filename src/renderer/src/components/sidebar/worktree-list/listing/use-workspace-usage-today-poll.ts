import { useEffect } from 'react'
import { useAppStore } from '@/store'

// Why: today's token usage is cheap to recompute (cached provider state) but not
// free, so the whole sidebar shares one poll instead of each workspace card fetching.
const POLL_MS = 120_000

export function useWorkspaceUsageTodayPoll(): void {
  const fetchWorkspaceUsageToday = useAppStore((s) => s.fetchWorkspaceUsageToday)
  useEffect(() => {
    void fetchWorkspaceUsageToday()
    const id = setInterval(() => void fetchWorkspaceUsageToday(), POLL_MS)
    return () => clearInterval(id)
  }, [fetchWorkspaceUsageToday])
}
