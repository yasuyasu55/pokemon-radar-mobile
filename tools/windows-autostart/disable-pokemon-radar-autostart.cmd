@echo off
setlocal
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-pokemon-radar-autostart.ps1" -Mode Check
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0disable-pokemon-radar-autostart.ps1" %*
)
set "RADAR_RESULT=%ERRORLEVEL%"
echo.
echo Exit code: %RADAR_RESULT%
pause
exit /b %RADAR_RESULT%

