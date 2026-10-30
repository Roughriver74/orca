import type { TokenEconomizerStatus } from '../../shared/token-economizer-status'

export type TokenEconomizerApi = {
  getStatus: () => Promise<TokenEconomizerStatus>
  onChanged: (callback: (status: TokenEconomizerStatus) => void) => () => void
}
