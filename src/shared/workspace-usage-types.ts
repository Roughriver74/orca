export type WorkspaceUsageProviderId = 'claude' | 'codex'

export type WorkspaceUsageProviderToday = {
  provider: WorkspaceUsageProviderId
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  estimatedCostUsd: number | null
}

export type WorkspaceUsageToday = {
  worktreeId: string
  providers: WorkspaceUsageProviderToday[]
  totalTokens: number
  estimatedCostUsd: number | null
  // Why: some providers/models lack pricing data, so a nonzero total cost can
  // still understate spend — the UI needs to say "at least" rather than exact.
  hasPartialCost: boolean
}
