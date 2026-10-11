import type React from 'react'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { useAppStore } from '../../store'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { translate } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { reindexPromptSnippets } from '../../../../shared/prompt-snippets'
import type { PromptSnippet } from '../../../../shared/prompt-snippet-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  PromptLibrarySnippetDialog,
  type PromptLibrarySnippetDraft
} from './PromptLibrarySnippetDialog'

type PromptLibraryPaneProps = {
  settings: GlobalSettings
}

export function PromptLibraryPane({ settings }: PromptLibraryPaneProps): React.JSX.Element {
  const updateSettings = useAppStore((s) => s.updateSettings)
  const confirm = useConfirmationDialog()
  const snippets = settings.promptLibrarySnippets ?? []
  const [draft, setDraft] = useState<PromptLibrarySnippetDraft | null>(null)

  const persist = (next: PromptSnippet[]): void => {
    void updateSettings({ promptLibrarySnippets: reindexPromptSnippets(next) })
  }

  const handleAdd = (): void => {
    setDraft({ id: createBrowserUuid(), name: '', body: '' })
  }

  const handleEdit = (snippet: PromptSnippet): void => {
    setDraft({ id: snippet.id, name: snippet.name, body: snippet.body })
  }

  const handleSave = (saved: PromptLibrarySnippetDraft): void => {
    const exists = snippets.some((snippet) => snippet.id === saved.id)
    const next = exists
      ? snippets.map((snippet) => (snippet.id === saved.id ? { ...snippet, ...saved } : snippet))
      : [...snippets, { ...saved, sortOrder: snippets.length }]
    persist(next)
    setDraft(null)
  }

  const handleDelete = async (snippet: PromptSnippet): Promise<void> => {
    const confirmed = await confirm({
      title: translate('promptLibrary.settings.deleteTitle', 'Delete "{{value0}}"?', {
        value0: snippet.name
      }),
      confirmLabel: translate('promptLibrary.settings.delete', 'Delete'),
      confirmVariant: 'destructive'
    })
    if (confirmed) {
      persist(snippets.filter((candidate) => candidate.id !== snippet.id))
    }
  }

  const handleMove = (snippet: PromptSnippet, direction: -1 | 1): void => {
    const index = snippets.findIndex((candidate) => candidate.id === snippet.id)
    const targetIndex = index + direction
    if (index === -1 || targetIndex < 0 || targetIndex >= snippets.length) {
      return
    }
    const next = [...snippets]
    const [moved] = next.splice(index, 1)
    if (moved) {
      next.splice(targetIndex, 0, moved)
    }
    persist(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={handleAdd}>
          <Plus className="size-4" />
          {translate('promptLibrary.settings.addPrompt', 'Add Prompt')}
        </Button>
      </div>
      {snippets.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {translate('promptLibrary.settings.empty', 'No saved prompts yet.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {snippets.map((snippet, index) => (
            <li
              key={snippet.id}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{snippet.name}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{snippet.body}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === 0}
                onClick={() => handleMove(snippet, -1)}
                aria-label={translate('promptLibrary.settings.moveUp', 'Move up')}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={index === snippets.length - 1}
                onClick={() => handleMove(snippet, 1)}
                aria-label={translate('promptLibrary.settings.moveDown', 'Move down')}
              >
                <ArrowDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleEdit(snippet)}
                aria-label={translate('promptLibrary.settings.edit', 'Edit')}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleDelete(snippet)}
                aria-label={translate('promptLibrary.settings.delete', 'Delete')}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <PromptLibrarySnippetDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onSave={handleSave}
      />
    </div>
  )
}
