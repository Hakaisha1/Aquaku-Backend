@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0test-forum-staging.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
pause
exit /b %exitCode%
