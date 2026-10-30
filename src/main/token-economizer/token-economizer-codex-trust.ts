import { CODEX_READ_ONLY_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { runCodexHookTrustGrantSession } from '../codex/codex-app-server-client'
import { normalizeHookTrustKeyForLookup } from '../codex/config-toml-trust'
import { TOKEN_ECONOMIZER_PLUGIN_ID } from './token-economizer-plan'

const TOKEN_ECONOMIZER_CODEX_HOOK_EVENTS = [
  'session_start',
  'user_prompt_submit',
  'post_tool_use',
  'stop',
  'session_end'
]
// The exact command TE's plugin manifest declares; the grant only touches hooks that match it.
const TOKEN_ECONOMIZER_CODEX_HOOK_COMMAND =
  '"${PLUGIN_ROOT:-$CLAUDE_PLUGIN_ROOT}/scripts/te-hook" --host codex'
const TRUST_GRANT_TIMEOUT_MS = 60_000

/** Trusts TokenEconomizer's five Codex hooks in one home; Codex skips untrusted plugin hooks. */
export async function grantTokenEconomizerCodexTrust(
  codexPath: string,
  codexHome: string
): Promise<void> {
  const result = await runCodexHookTrustGrantSession({
    invocation: {
      command: codexPath,
      // Plugins stay enabled: the plugin's hooks only appear in hooks/list when it loads.
      args: [...CODEX_READ_ONLY_APP_SERVER_ARGS],
      cliPath: codexPath,
      env: { CODEX_HOME: codexHome },
      timeoutMs: TRUST_GRANT_TIMEOUT_MS
    },
    hooksListCwd: codexHome,
    expectedTrustKeys: TOKEN_ECONOMIZER_CODEX_HOOK_EVENTS.map((event) =>
      normalizeHookTrustKeyForLookup(
        `${TOKEN_ECONOMIZER_PLUGIN_ID}:hooks/codex-hooks.json:${event}:0:0`
      )
    ),
    managedCommand: TOKEN_ECONOMIZER_CODEX_HOOK_COMMAND
  })
  if (result.outcome !== 'granted') {
    throw new Error(`Codex hook trust not granted: ${result.reason}`)
  }
}
