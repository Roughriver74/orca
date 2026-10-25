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
      'auto.components.settings.companion.pane.search.wakeTitle',
      'Слушать всегда, отвечать по обращению'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.wakeTitleDescription',
      'Постоянное прослушивание с ответом только на обращение по имени.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.wakeWord',
        'wake word'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.showPanelOnAddressTitle',
      'Показывать панель при обращении'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.showPanelOnAddressTitleDescription',
      'Открывать большую панель, когда к Джарвису обратились по имени.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword('auto.components.settings.companion.pane.search.panel', 'big panel')
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.autoHidePanelAfterReplyTitle',
      'Прятать панель после ответа'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.autoHidePanelAfterReplyTitleDescription',
      'Панель скрывается сама через несколько секунд после ответа.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.autoHide',
        'auto hide'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.voiceBargeInTitle',
      'Перебивать голосом'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.voiceBargeInTitleDescription',
      'Остановить ответ Джарвиса, просто начав говорить.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.bargeIn',
        'barge-in'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.interrupt',
        'interrupt'
      )
    ]
  },
  {
    title: translate(
      'auto.components.settings.companion.pane.search.endKeywordTitle',
      'Слово-сигнал'
    ),
    description: translate(
      'auto.components.settings.companion.pane.search.endKeywordTitleDescription',
      'Не отправлять реплику на паузе — только после слова «думай», «всё» и т. п.'
    ),
    keywords: [
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.companion',
        'companion'
      ),
      ...translateSearchKeyword(
        'auto.components.settings.companion.pane.search.endKeyword',
        'end keyword'
      ),
      ...translateSearchKeyword('auto.components.settings.companion.pane.search.pause', 'pause')
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
