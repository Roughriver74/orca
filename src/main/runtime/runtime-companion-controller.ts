import { randomUUID } from 'node:crypto'
import { getAppEnvironment } from '../../shared/app-environment'
import { getDefaultCompanionSettings } from '../../shared/constants'
import type {
  CompanionConversationState,
  CompanionSettings,
  CompanionTtsProvisioningStatus
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

/** Bridges the RPC/CLI surface to the one persistent `CompanionBrain` conversation,
 *  the same role `RuntimeMobileSpeechCatalog` plays for the speech services. */
export class RuntimeCompanionController {
  constructor(private readonly getStore: () => RuntimeStore | null) {}

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
    // Why dynamic rather than a top-level import: the TTS module pulls in the bundled
    // `.py?asset&asarUnpack` sidecar path at import time, which only resolves inside a
    // real (or asset-mocked) Vite/electron-vite build — loading it eagerly would force
    // every caller of this file, including the unrelated `ask()` path and its tests, to
    // carry that asset resolution for a platform-gated feature they never touch.
    const { getCompanionTtsService } = await import('../companion/tts/companion-tts-service')
    const userDataDir = getAppEnvironment().getPath('userData')
    const service = getCompanionTtsService(userDataDir)
    const utteranceId = randomUUID()
    await service.speak(params.text, { utteranceId, voice: tts.ttsVoice, rate: tts.ttsRate })
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
