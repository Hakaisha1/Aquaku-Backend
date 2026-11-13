@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0grant-cloudinary-forum-folder-role.ps1"
set "exitCode=%ERRORLEVEL%"
echo.
pause
exit /b %exitCode%
