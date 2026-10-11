import { useAppStore } from '../../store'

export function registerPromptLibraryIpcBridge(unsubs: (() => void)[]): void {
  unsubs.push(
    window.api.ui.onOpenPromptLibrary(() => {
      useAppStore.getState().openModal('prompt-library')
    })
  )
}
