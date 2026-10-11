@echo off
setlocal
rem Stops everything started from the Orca Portable folder, then deletes the folder (tokens included).
if not "%~1"=="" goto delete_folder

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
echo This stops Orca and its agents started from this folder and deletes it:
echo   %ROOT%
choice /m "Continue"
if errorlevel 2 exit /b 1
rem Why a temp copy: cmd keeps the running script open, so it cannot delete its own folder.
copy /y "%~f0" "%TEMP%\orca-portable-remove.cmd" >nul
"%TEMP%\orca-portable-remove.cmd" "%ROOT%"

:delete_folder
set "ROOT=%~1"
powershell -NoProfile -Command "$r = $env:ROOT; Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($r, [System.StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 3 /nobreak >nul
cd /d "%TEMP%"
rmdir /s /q "%ROOT%"
if exist "%ROOT%" (
  echo Some files are still in use. Close remaining windows and run this again, or delete the folder manually.
  pause
) else (
  echo Removed "%ROOT%"
  timeout /t 3 /nobreak >nul
)
(goto) 2>nul & del "%~f0"
