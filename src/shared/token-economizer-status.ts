export type TokenEconomizerStatus = {
  state: 'off' | 'installing' | 'installed' | 'python_missing' | 'error'
  detail?: string
  /** Agent config homes the plugin is installed in. */
  homes?: string[]
}
