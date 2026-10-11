Orca Portable
=============

Запуск:   Start-Orca.cmd
Удаление: Remove-Orca.cmd  (закрывает Orca и агентов из этой папки и удаляет папку целиком)

Что внутри
  app\       Orca (своя сборка, автообновление выключено)
  bin\       claude.exe, codex.exe и PortableGit (распаковывается в git\ при первом запуске)
  home\      домашняя папка для Orca и агентов: логин Codex, настройки Claude, хуки
  data\      настройки и проекты Orca (появляется после первого запуска)
  secrets\   токен подписки Claude

Всё пишется только в эту папку: Start-Orca.cmd подменяет USERPROFILE, HOME, APPDATA и
LOCALAPPDATA на home\ и запускает Orca с --user-data-dir=data.

ВНИМАНИЕ: в папке лежат токены твоих подписок Claude и Codex. Не оставляй её на чужих или
общих серверах. После работы запусти Remove-Orca.cmd.
Если папка потерялась:
  Claude: отзови токен в настройках аккаунта на claude.ai или выйди со всех устройств
  Codex:  chatgpt.com -> Settings -> Security -> "Log out of all devices", потом `codex login` на Mac

Первый запуск: Windows SmartScreen может предупредить о неподписанном приложении —
"Подробнее" -> "Выполнить в любом случае".
