import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getPromptLibraryPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('promptLibrary.settings.title', 'Prompt Library'),
    description: translate(
      'promptLibrary.settings.description',
      'Saved prompt snippets with variables, insertable from the command palette or a shortcut.'
    ),
    keywords: [
      ...translateSearchKeyword('promptLibrary.settings.keywords.prompt', 'prompt'),
      ...translateSearchKeyword('promptLibrary.settings.keywords.prompts', 'prompts'),
      ...translateSearchKeyword('promptLibrary.settings.keywords.snippet', 'snippet'),
      ...translateSearchKeyword('promptLibrary.settings.keywords.library', 'library'),
      ...translateSearchKeyword('promptLibrary.settings.keywords.template', 'template'),
      ...translateSearchKeyword('promptLibrary.settings.keywords.insert', 'insert')
    ]
  }
])
