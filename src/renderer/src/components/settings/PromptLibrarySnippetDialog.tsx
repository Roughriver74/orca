import type React from 'react'
import { useState } from 'react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group'
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
import {
  isPromptSnippetTrigger,
  PROMPT_SNIPPET_TRIGGERS,
  type PromptSnippet,
  type PromptSnippetTrigger
} from '../../../../shared/prompt-snippet-types'

export type PromptLibrarySnippetDraft = Pick<PromptSnippet, 'id' | 'name' | 'body' | 'when'>

type PromptLibrarySnippetDialogProps = {
  draft: PromptLibrarySnippetDraft | null
  onClose: () => void
  onSave: (draft: PromptLibrarySnippetDraft) => void
}

// Why literal keys: the boot English catalog only resolves statically extracted translate() calls.
function triggerLabel(trigger: PromptSnippetTrigger): string {
  switch (trigger) {
    case 'checkFailed':
      return translate('promptLibrary.triggers.checkFailed', 'Check failed')
    case 'overlap':
      return translate('promptLibrary.triggers.overlap', 'Files overlap a sibling worktree')
    case 'agentDone':
      return translate('promptLibrary.triggers.agentDone', 'Agent finished')
    case 'hasIssue':
      return translate('promptLibrary.triggers.hasIssue', 'Linked issue')
    case 'hasChanges':
      return translate('promptLibrary.triggers.hasChanges', 'Has changed files')
  }
}

export function PromptLibrarySnippetDialog({
  draft,
  onClose,
  onSave
}: PromptLibrarySnippetDialogProps): React.JSX.Element {
  const [name, setName] = useState(draft?.name ?? '')
  const [body, setBody] = useState(draft?.body ?? '')
  const [when, setWhen] = useState<PromptSnippetTrigger[]>(draft?.when ?? [])
  const [lastDraftId, setLastDraftId] = useState(draft?.id ?? null)

  // Why: reset form state during render (not useEffect) so switching which snippet is
  // being edited paints the new values on the same frame the dialog reopens.
  const draftId = draft?.id ?? null
  if (draftId !== lastDraftId) {
    setLastDraftId(draftId)
    setName(draft?.name ?? '')
    setBody(draft?.body ?? '')
    setWhen(draft?.when ?? [])
  }

  const referenced = listReferencedPromptSnippetVariables(body)
  const canSave = isPromptSnippetComplete({ name, body })

  const handleSave = (): void => {
    if (!draft || !canSave) {
      return
    }
    onSave({ id: draft.id, name: name.trim(), body, when: when.length > 0 ? when : undefined })
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
          <div className="flex flex-col gap-1.5">
            <Label>{translate('promptLibrary.triggers.label', 'Suggest as a chip when')}</Label>
            <ToggleGroup
              type="multiple"
              variant="outline"
              size="sm"
              spacing={4}
              value={when}
              onValueChange={(value) => setWhen(value.filter(isPromptSnippetTrigger))}
              className="flex flex-wrap"
            >
              {PROMPT_SNIPPET_TRIGGERS.map((trigger) => (
                <ToggleGroupItem key={trigger} value={trigger} aria-label={triggerLabel(trigger)}>
                  {triggerLabel(trigger)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
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
