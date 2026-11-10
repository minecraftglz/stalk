@echo off
REM ============================================================
REM Stalk Windows Agent - one-click launcher (silent / background)
REM
REM Double-click to start with NO persistent console window.
REM Optional: put a shortcut in shell:startup for auto-start on boot.
REM
REM   - normal run : starts the agent hidden via start-windows-agent.vbs
REM   - debug run  : run this bat as  start-windows-agent.bat debug
REM                  to launch windows-agent.ps1 in a visible console
REM ============================================================
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if /i "%~1"=="debug" goto :debug

REM ---- Normal: launch the silent VBS launcher (no window) ----
if exist "%~dp0start-windows-agent.vbs" (
  start "" wscript //nologo "%~dp0start-windows-agent.vbs"
  exit /b 0
)

REM ---- Fallback: native no-window launcher exe ----
if exist "%~dp0stalk-launcher.exe" (
  start "" "%~dp0stalk-launcher.exe"
  exit /b 0
)

echo [ERROR] Neither start-windows-agent.vbs nor stalk-launcher.exe found.
pause
exit /b 1

:debug
REM ---- Debug: visible console so you can watch the logs ----
if not exist "%~dp0windows-agent.ps1" (
  echo [ERROR] windows-agent.ps1 not found.
  pause
  exit /b 1
)
set "PSEXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PSEXE%" set "PSEXE=powershell.exe"

echo Starting Stalk Windows Agent in DEBUG mode (console visible)...
echo Press Ctrl+C to stop.
"%PSEXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-agent.ps1"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" ( echo Agent stopped. ) else ( echo [ERROR] Agent exited with code %RC%. )
pause
exit /b %RC%
