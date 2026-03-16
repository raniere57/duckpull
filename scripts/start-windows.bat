@echo off
setlocal
chcp 65001 >nul
set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%start-windows.ps1"
set EXIT_CODE=%ERRORLEVEL%
if not "%EXIT_CODE%"=="0" (
  echo.
  echo Falha ao iniciar o duckpull. Codigo: %EXIT_CODE%
  pause
)
exit /b %EXIT_CODE%
