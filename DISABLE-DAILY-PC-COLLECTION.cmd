@echo off
setlocal
cd /d "%LOCALAPPDATA%\PokemonRadarCollector\source"
if errorlevel 1 exit /b 1
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "tools\pc-collector\install-daily.ps1" -Disable
pause
