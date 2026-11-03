@echo off
setlocal
set "radarSource=%LOCALAPPDATA%\PokemonRadarCollector\source"
if not exist "%radarSource%\.git" (
 echo Run START-PC-COLLECTION.cmd successfully first.
 pause
 exit /b 1
)
cd /d "%radarSource%"
git pull --ff-only origin main
if errorlevel 1 goto failed
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "tools\pc-collector\install-daily.ps1"
if errorlevel 1 goto failed
pause
exit /b 0
:failed
echo SETUP FAILED. Send this screen. Automatic operation is not confirmed.
pause
exit /b 1
