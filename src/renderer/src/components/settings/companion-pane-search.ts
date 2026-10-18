import type { SettingsSearchEntry } from './settings-search'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'

export const getCompanionPaneSearchEntries = createLocalizedCatalog((): SettingsSearchEntry[] => [
  {
    title: translate('auto.components.settings.companion.pane.search.enable', 'Включить Джарвиса'),
    description: translate(
      'auto.components.settings.companion.pane.search.enableDescription',
      'Голосовой помощник по горячей клавише, работает поверх всех приложений.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword('auto.components.settings.companion.pane.search.jarvis', 'jarvis'),
      ...translateSearchKeyword('auto.components.settings.companion.pane.search.voice', 'voice'),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.hotkey',
        'global hotkey'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.hotkeyTitle',
      'Горячая клавиша'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.hotkeyTitleDescription',
      'Клавиша для открытия панели Джарвиса из любого приложения.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.shortcut',
        'shortcut'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.sttModelTitle',
      'Модель распознавания'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.sttModelTitleDescription',
      'Речь-в-текст модель для прослушивания Джарвисом.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.stt',
        'speech to text'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.ttsTitle',
      'Озвучивать ответы'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.ttsTitleDescription',
      'Голос и скорость озвучки ответов Джарвиса.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.tts',
        'text to speech'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.notifyTitle',
      'Уведомлять о других агентах'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.notifyTitleDescription',
      'Тихое уведомление, когда агент закончил работу или ждёт решения, плюс тихие часы.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.notify',
        'notifications'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.quietHours',
        'quiet hours'
      )
    ]
  }
])
