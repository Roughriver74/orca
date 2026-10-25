// Resolves the TTS handle a dialogue turn speaks with, from live settings: null when voice
// replies are off or no TTS service is wired (orcad never injects one — see initCompanionDialogue).

import { join } from 'node:path'
import { getAppEnvironment } from '../../shared/app-environment'
import type { CompanionSettings } from '../../shared/companion-types'
import { getDefaultCompanionSettings } from '../../shared/constants'
import { resolveCompanionHomeDir } from './companion-brain'
import type { CompanionDialogueActiveTts } from './companion-dialogue-contract'
import type { CompanionTtsService } from './tts/companion-tts-service'
import { COMPANION_TTS_PRONUNCIATIONS_FILE_NAME } from './tts/companion-tts-pronunciation-dictionary'

export function resolveCompanionDialogueTts(
  companion: CompanionSettings | undefined,
  getTtsService: ((userDataDir: string) => CompanionTtsService | null) | undefined
): CompanionDialogueActiveTts | null {
  const tts = companion?.tts ?? getDefaultCompanionSettings().tts
  if (!tts.ttsEnabled || !getTtsService) {
    return null
  }
  const service = getTtsService(getAppEnvironment().getPath('userData'))
  if (!service) {
    return null
  }
  return {
    service,
    voice: tts.ttsVoice,
    rate: tts.ttsRate,
    pronunciationsPath: join(
      resolveCompanionHomeDir(companion?.homeDir),
      COMPANION_TTS_PRONUNCIATIONS_FILE_NAME
    )
  }
}
