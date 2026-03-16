@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%enable-autostart-windows.ps1"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Falha ao habilitar autostart do duckpull. Codigo: %EXIT_CODE%
  pause
)
exit /b %EXIT_CODE%
