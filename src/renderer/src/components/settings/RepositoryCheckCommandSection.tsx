import { useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

type RepositoryCheckCommandSectionProps = {
  repo: Repo
  updateRepo: (
    repoId: string,
    updates: Partial<Pick<Repo, 'checkCommand' | 'checkAutoFix'>>
  ) => void | Promise<boolean>
  forceVisible: boolean
}

export function RepositoryCheckCommandSection({
  repo,
  updateRepo,
  forceVisible
}: RepositoryCheckCommandSectionProps): React.JSX.Element {
  const [draft, setDraft] = useState(repo.checkCommand ?? '')
  if (draft !== (repo.checkCommand ?? '') && document.activeElement?.id !== 'check-command-input') {
    setDraft(repo.checkCommand ?? '')
  }

  const commitCheckCommand = (): void => {
    const trimmed = draft.trim()
    if (trimmed === (repo.checkCommand ?? '').trim()) {
      return
    }
    void updateRepo(repo.id, { checkCommand: trimmed || undefined })
  }

  return (
    <SearchableSetting
      title={translate(
        'auto.components.settings.RepositoryCheckCommandSection.title',
        'Check Command'
      )}
      description={translate(
        'auto.components.settings.RepositoryCheckCommandSection.description',
        "Shell command that verifies an agent's work. Runs automatically in this workspace once an agent finishes. Leave blank to disable."
      )}
      keywords={[
        repo.displayName,
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordCheck',
          'check'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordVerify',
          'verify'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordTest',
          'test'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordTypecheck',
          'typecheck'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordPostAgent',
          'post-agent'
        ),
        ...translateSearchKeyword(
          'auto.components.settings.RepositoryCheckCommandSection.keywordAutoFix',
          'auto-fix'
        )
      ]}
      className="space-y-2"
      forceVisible={forceVisible}
    >
      <Label htmlFor="check-command-input">
        {translate('auto.components.settings.RepositoryCheckCommandSection.title', 'Check Command')}
      </Label>
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.components.settings.RepositoryCheckCommandSection.description',
          "Shell command that verifies an agent's work. Runs automatically in this workspace once an agent finishes. Leave blank to disable."
        )}
      </p>
      <textarea
        id="check-command-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitCheckCommand}
        placeholder={translate(
          'auto.components.settings.RepositoryCheckCommandSection.placeholder',
          'pnpm tc && pnpm test'
        )}
        rows={3}
        spellCheck={false}
        className="w-full min-w-0 resize-y rounded-md border border-input bg-muted/20 px-3 py-2 font-mono text-xs shadow-xs transition-[color,box-shadow] outline-none placeholder:italic placeholder:text-muted-foreground/60 focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/40"
      />
      <div className="flex items-center justify-between gap-3 pt-2">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="check-auto-fix-toggle">
            {translate(
              'auto.components.settings.RepositoryCheckCommandSection.autoFixTitle',
              'Send failures to the agent'
            )}
          </Label>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RepositoryCheckCommandSection.autoFixHint',
              'When the check fails after an agent finishes, Orca sends the failure output back to that agent (up to 3 times in a row).'
            )}
          </p>
        </div>
        <Switch
          id="check-auto-fix-toggle"
          aria-label={translate(
            'auto.components.settings.RepositoryCheckCommandSection.autoFixTitle',
            'Send failures to the agent'
          )}
          disabled={!(repo.checkCommand ?? '').trim()}
          checked={repo.checkAutoFix === true}
          onCheckedChange={(checked) => void updateRepo(repo.id, { checkAutoFix: checked })}
        />
      </div>
    </SearchableSetting>
  )
}
