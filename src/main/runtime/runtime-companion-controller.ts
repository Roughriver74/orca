import { randomUUID } from 'node:crypto'
import { getAppEnvironment } from '../../shared/app-environment'
import { getDefaultCompanionSettings } from '../../shared/constants'
import type {
  CompanionConversationState,
  CompanionSettings,
  CompanionTtsProvisioningStatus,
  CompanionTtsVoice
} from '../../shared/companion-types'
import { getCompanionBrain, type CompanionBrainEvent } from '../companion/companion-brain'
import { companionConversation } from '../companion/companion-conversation'
import { getCompanionTtsProvisioningStatus } from '../companion/tts/companion-tts-provisioning'
import type { RuntimeStore } from './runtime-store-contract'

export type RuntimeCompanionAskResult = { text: string }
export type RuntimeCompanionSayResult = { utteranceId: string }
export type RuntimeCompanionStatusResult = {
  enabled: boolean
  state: CompanionConversationState
  hotkey: string
  lastUserText: string | null
  lastAssistantText: string | null
  updatedAt: number
  tts: CompanionTtsProvisioningStatus
}
export type RuntimeCompanionToggleResult = { state: CompanionConversationState }

/** Synthesizes one utterance. Injected from the Electron-only TTS wiring (`main-process-
 *  runtime-service.ts`) because its real implementation imports `companion-tts-service.ts`,
 *  which pulls in the bundled `.py?asset&asarUnpack` Silero sidecar path at import time —
 *  resolvable only inside a real (or asset-mocked) Vite/electron-vite build. Importing that
 *  module from this file, even behind a dynamic `import()`, would still make orcad's plain
 *  esbuild bundle (which has no `.py` loader, by design: orcad is a headless Node host that
 *  must never need a Python sidecar) try to resolve that asset, since esbuild inlines every
 *  module an entry point reaches, dynamic imports included. Keeping the import out of this
 *  file entirely — not just out of `say()`'s hot path — is what keeps orcad's graph clean. */
export type CompanionTtsSpeaker = (params: {
  userDataDir: string
  text: string
  utteranceId: string
  voice: CompanionTtsVoice
  rate: number
}) => Promise<void>

/** Bridges the RPC/CLI surface to the one persistent `CompanionBrain` conversation,
 *  the same role `RuntimeMobileSpeechCatalog` plays for the speech services. */
export class RuntimeCompanionController {
  private ttsSpeaker: CompanionTtsSpeaker | null = null

  constructor(private readonly getStore: () => RuntimeStore | null) {}

  /** Wired once from Electron main startup; stays null on orcad (see `CompanionTtsSpeaker`). */
  setTtsSpeaker(speaker: CompanionTtsSpeaker): void {
    this.ttsSpeaker = speaker
  }

  async ask(params: { text: string; reset?: boolean }): Promise<RuntimeCompanionAskResult> {
    const store = this.requireStore()
    const brain = getCompanionBrain({
      getSettings: () =>
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `RuntimeStore.getSettings()` is a narrow structural type that omits `companion`; this reads only the two optional fields `CompanionBrain` needs, structurally compatible with whatever shape it lands as.
        store.getSettings() as unknown as {
          companion?: { homeDir?: string; brainModel?: CompanionSettings['brainModel'] }
        }
    })
    if (params.reset) {
      brain.reset()
    }
    let finalText: string | null = null
    let errorMessage: string | null = null
    const deltas: string[] = []
    await brain.send(params.text, (event: CompanionBrainEvent) => {
      if (event.type === 'delta') {
        deltas.push(event.text)
      } else if (event.type === 'final') {
        finalText = event.text
      } else if (event.type === 'error') {
        errorMessage = event.message
      }
    })
    if (errorMessage !== null) {
      throw new Error(errorMessage)
    }
    // The `result` frame's text is authoritative; the deltas that built it are a fallback
    // for a CLI that skipped it (shouldn't happen, but a fallback beats silence).
    return { text: finalText ?? deltas.join('') }
  }

  /** Synthesizes `text` with the companion's configured voice/rate and streams it to the panel. */
  async say(params: { text: string }): Promise<RuntimeCompanionSayResult> {
    const store = this.requireStore()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `GlobalSettings` has no `companion` field yet; CompanionShell adds it, and this reads only the one optional field, structurally compatible with whatever shape it lands as.
    const settings = store.getSettings() as unknown as { companion?: CompanionSettings }
    const tts = settings.companion?.tts ?? getDefaultCompanionSettings().tts
    if (!this.ttsSpeaker) {
      throw new Error('companion_tts_unavailable')
    }
    const userDataDir = getAppEnvironment().getPath('userData')
    const utteranceId = randomUUID()
    await this.ttsSpeaker({
      userDataDir,
      text: params.text,
      utteranceId,
      voice: tts.ttsVoice,
      rate: tts.ttsRate
    })
    return { utteranceId }
  }

  /** Snapshot for `orca companion status`: conversation state/turn text plus the
   *  enabled/hotkey settings and TTS provisioning readiness the panel also shows. */
  async status(): Promise<RuntimeCompanionStatusResult> {
    const store = this.requireStore()
    const settings = this.companionSettings(store)
    const snapshot = companionConversation.getSnapshot()
    const tts = await getCompanionTtsProvisioningStatus(getAppEnvironment().getPath('userData'))
    return {
      enabled: settings.enabled,
      state: snapshot.state,
      hotkey: settings.hotkey,
      lastUserText: snapshot.lastUserText,
      lastAssistantText: snapshot.lastAssistantText,
      updatedAt: snapshot.updatedAt,
      tts
    }
  }

  /** Same effect as pressing the companion hotkey: delegates to `toggleCompanionConversation`,
   *  not a parallel open/close implementation, so RPC/CLI and the hotkey can never drift. */
  async toggle(): Promise<RuntimeCompanionToggleResult> {
    const store = this.requireStore()
    const settings = this.companionSettings(store)
    if (!settings.enabled) {
      throw new Error('companion_disabled')
    }
    // Why dynamic: `companion-shortcut` imports `electron` (globalShortcut) at module scope;
    // a static import here would force every caller of this file — including the
    // electron-free ask()/say() tests — to mock electron they never touch.
    const { toggleCompanionConversation } = await import('../companion/companion-shortcut')
    toggleCompanionConversation()
    return { state: companionConversation.getState() }
  }

  private companionSettings(store: RuntimeStore): CompanionSettings {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: `GlobalSettings` has no `companion` field yet; CompanionShell adds it, and this reads only the one optional field, structurally compatible with whatever shape it lands as.
    const settings = store.getSettings() as unknown as { companion?: CompanionSettings }
    return settings.companion ?? getDefaultCompanionSettings()
  }

  private requireStore(): RuntimeStore {
    const store = this.getStore()
    if (!store) {
      throw new Error('companion_unavailable')
    }
    return store
  }
}
