import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import {
  expandPromptSnippet,
  type PromptSnippetExpansion
} from '../../../../shared/prompt-snippet-variables'
import { insertPromptSnippetIntoFocusedTarget } from './insert-prompt-snippet'
import {
  buildPromptSnippetVariableContext,
  resolvePromptSnippetClipboardVariable
} from './prompt-snippet-variable-context'
import type { PromptSnippet } from '../../../../shared/prompt-snippet-types'

const EMPTY_PROMPT_SNIPPETS: PromptSnippet[] = []

export default function PromptLibraryInsertModal(): React.JSX.Element | null {
  const open = useAppStore((s) => s.activeModal === 'prompt-library')
  const closeModal = useAppStore((s) => s.closeModal)
  const snippets = useAppStore((s) => s.settings?.promptLibrarySnippets ?? EMPTY_PROMPT_SNIPPETS)
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [preview, setPreview] = useState<PromptSnippetExpansion | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return snippets
    }
    return snippets.filter(
      (snippet) =>
        snippet.name.toLowerCase().includes(needle) || snippet.body.toLowerCase().includes(needle)
    )
  }, [snippets, query])

  // Why: reset the picker (and re-seed the first result) on every open, not on every
  // keystroke — the filtered-list effect below keeps the selection valid as you type.
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedId(snippets[0]?.id ?? null)
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only the open transition reseeds; `snippets` would re-fire on every settings write.
  }, [open])

  useEffect(() => {
    if (selectedId && !filtered.some((snippet) => snippet.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null)
    }
  }, [filtered, selectedId])

  const selected = filtered.find((snippet) => snippet.id === selectedId) ?? null

  useEffect(() => {
    if (!open || !selected) {
      setPreview(null)
      return
    }
    let cancelled = false
    const state = useAppStore.getState()
    const worktree = state.activeWorktreeId
      ? (findWorktreeById(state.worktreesByRepo, state.activeWorktreeId) ?? null)
      : null
    const repoDisplayName = worktree
      ? (state.repos.find((repo) => repo.id === worktree.repoId)?.displayName ?? null)
      : null
    const context = buildPromptSnippetVariableContext(state, worktree, repoDisplayName)
    void resolvePromptSnippetClipboardVariable(selected.body).then((clipboard) => {
      if (cancelled) {
        return
      }
      context.clipboard = clipboard
      setPreview(expandPromptSnippet(selected.body, context))
    })
    return () => {
      cancelled = true
    }
  }, [open, selected])

  const handleInsert = useCallback(async () => {
    if (!selected) {
      return
    }
    const result = await insertPromptSnippetIntoFocusedTarget(selected.body)
    closeModal()
    if (result.status === 'no-target') {
      toast.error(
        translate(
          'promptLibrary.insert.noTarget',
          'No active agent terminal or chat to insert into.'
        )
      )
    }
  }, [closeModal, selected])

  const handleInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        void handleInsert()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const index = filtered.findIndex((snippet) => snippet.id === selectedId)
        const delta = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = filtered.length ? (index + delta + filtered.length) % filtered.length : -1
        setSelectedId(nextIndex >= 0 ? (filtered[nextIndex]?.id ?? null) : null)
      }
    },
    [filtered, handleInsert, selectedId]
  )

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && closeModal()}>
      <DialogContent
        className="flex max-h-[32rem] flex-col overflow-hidden sm:max-w-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Sparkles className="size-4 text-muted-foreground" />
              {translate('promptLibrary.insert.title', 'Insert Prompt')}
            </span>
          </DialogTitle>
          <DialogDescription>
            {translate(
              'promptLibrary.insert.description',
              'Pastes the expanded prompt into the focused agent terminal or chat — it does not submit.'
            )}
          </DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={translate('promptLibrary.insert.searchPlaceholder', 'Search prompts…')}
          aria-label={translate('promptLibrary.insert.searchPlaceholder', 'Search prompts…')}
        />
        <div className="flex min-h-0 flex-1 gap-3">
          <div className="w-56 shrink-0 overflow-hidden rounded-md border border-border">
            <ScrollArea className="h-full">
              <div className="flex flex-col gap-0.5 p-2">
                {filtered.length === 0 ? (
                  <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                    {translate('promptLibrary.insert.empty', 'No saved prompts match your search.')}
                  </p>
                ) : (
                  filtered.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      onClick={() => setSelectedId(snippet.id)}
                      onDoubleClick={() => void handleInsert()}
                      className={cn(
                        'truncate rounded-md px-2 py-1.5 text-left text-sm',
                        snippet.id === selectedId
                          ? 'bg-accent text-accent-foreground'
                          : 'text-foreground hover:bg-accent/60'
                      )}
                    >
                      {snippet.name}
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            {selected ? (
              <>
                <p className="text-xs font-medium text-muted-foreground">
                  {translate('promptLibrary.insert.previewLabel', 'Preview')}
                </p>
                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-muted/30">
                  <ScrollArea className="h-full">
                    <pre className="whitespace-pre-wrap p-3 font-mono text-xs text-foreground">
                      {preview?.text ?? selected.body}
                    </pre>
                  </ScrollArea>
                </div>
                {preview && preview.missing.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {translate(
                      'promptLibrary.insert.missingVariables',
                      'Not available here, left blank: {{value0}}',
                      { value0: preview.missing.map((name) => `{${name}}`).join(', ') }
                    )}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="m-auto text-sm text-muted-foreground">
                {translate('promptLibrary.insert.noSelection', 'Select a prompt to preview it.')}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
