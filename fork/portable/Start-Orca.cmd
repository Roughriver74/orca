@echo off
setlocal
rem Orca Portable: every per-user file (settings, agent logins, hooks, caches) stays in this folder.
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PHOME=%ROOT%\home"

if not exist "%ROOT%\app\Orca.exe" (
  echo Orca.exe not found in "%ROOT%\app". Unpack the whole archive first.
  pause
  exit /b 1
)
if not exist "%PHOME%\AppData\Roaming" mkdir "%PHOME%\AppData\Roaming"
if not exist "%PHOME%\AppData\Local" mkdir "%PHOME%\AppData\Local"

rem Claude Code on Windows needs Git Bash; unpack the bundled PortableGit once.
if not exist "%ROOT%\bin\PortableGit.7z.exe" goto git_done
if exist "%ROOT%\git\bin\bash.exe" goto git_done
echo Unpacking Git (first start only)...
"%ROOT%\bin\PortableGit.7z.exe" -o"%ROOT%\git" -y >nul
:git_done
if not exist "%ROOT%\git\bin\bash.exe" goto git_env_done
set "CLAUDE_CODE_GIT_BASH_PATH=%ROOT%\git\bin\bash.exe"
set "PATH=%ROOT%\git\cmd;%PATH%"
:git_env_done

set "USERPROFILE=%PHOME%"
set "HOME=%PHOME%"
set "APPDATA=%PHOME%\AppData\Roaming"
set "LOCALAPPDATA=%PHOME%\AppData\Local"
set "PATH=%ROOT%\bin;%PATH%"
if exist "%ROOT%\secrets\claude-token.txt" set /p CLAUDE_CODE_OAUTH_TOKEN=<"%ROOT%\secrets\claude-token.txt"

start "" "%ROOT%\app\Orca.exe" --user-data-dir="%ROOT%\data"
endlocal
