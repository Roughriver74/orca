import type React from 'react'
import { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { translate } from '@/i18n/i18n'
import {
  listReferencedPromptSnippetVariables,
  PROMPT_SNIPPET_VARIABLE_NAMES
} from '../../../../shared/prompt-snippet-variables'
import { isPromptSnippetComplete } from '../../../../shared/prompt-snippets'
import type { PromptSnippet } from '../../../../shared/prompt-snippet-types'

export type PromptLibrarySnippetDraft = Pick<PromptSnippet, 'id' | 'name' | 'body'>

type PromptLibrarySnippetDialogProps = {
  draft: PromptLibrarySnippetDraft | null
  onClose: () => void
  onSave: (draft: PromptLibrarySnippetDraft) => void
}

export function PromptLibrarySnippetDialog({
  draft,
  onClose,
  onSave
}: PromptLibrarySnippetDialogProps): React.JSX.Element {
  const [name, setName] = useState(draft?.name ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [lastDraftId, setLastDraftId] = useState(draft?.id ?? null)

  // Why: reset form state during render (not useEffect) so switching which snippet is
  // being edited paints the new values on the same frame the dialog reopens.
  const draftId = draft?.id ?? null
  if (draftId !== lastDraftId) {
    setLastDraftId(draftId)
    setName(draft?.name ?? '')
    setBody(draft?.body ?? '')
  }

  const referenced = listReferencedPromptSnippetVariables(body)
  const canSave = isPromptSnippetComplete({ name, body })

  const handleSave = (): void => {
    if (!draft || !canSave) {
      return
    }
    onSave({ id: draft.id, name: name.trim(), body })
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{translate('promptLibrary.settings.dialogTitle', 'Prompt')}</DialogTitle>
          <DialogDescription>
            {translate(
              'promptLibrary.settings.dialogDescription',
              'Variables expand when you insert the prompt: {{value0}}.',
              {
                value0: PROMPT_SNIPPET_VARIABLE_NAMES.map((variable) => `{${variable}}`).join(', ')
              }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-library-snippet-name">
              {translate('promptLibrary.settings.nameLabel', 'Name')}
            </Label>
            <Input
              id="prompt-library-snippet-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={translate(
                'promptLibrary.settings.namePlaceholder',
                'e.g. Review this file'
              )}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prompt-library-snippet-body">
              {translate('promptLibrary.settings.bodyLabel', 'Prompt')}
            </Label>
            <Textarea
              id="prompt-library-snippet-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={6}
              variant="code"
              placeholder={translate(
                'promptLibrary.settings.bodyPlaceholder',
                'Review {file} on {branch}.'
              )}
            />
            {referenced.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate('promptLibrary.settings.usesVariables', 'Uses: {{value0}}', {
                  value0: referenced.map((variable) => `{${variable}}`).join(', ')
                })}
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {translate('promptLibrary.settings.cancel', 'Cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {translate('promptLibrary.settings.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
