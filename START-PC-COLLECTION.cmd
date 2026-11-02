@echo off
setlocal
set "radarState=%LOCALAPPDATA%\PokemonRadarCollector"
if not exist "%radarState%" mkdir "%radarState%"
set "radarCheck=%radarState%\pc-check.txt"
set "radarSource=%radarState%\source"
echo POKEMON RADAR PC check > "%radarCheck%"
echo %date% %time% >> "%radarCheck%"
where node >nul 2>nul
if errorlevel 1 (
 echo Missing: Node.js 22 or newer >> "%radarCheck%"
 goto missing
)
node -e "process.exit(Math.sign(Number(process.versions.node.split('.')[0])-22)===-1?1:0)"
if errorlevel 1 (
 echo Node.js must be version 22 or newer. >> "%radarCheck%"
 goto missing
)
where git >nul 2>nul
if errorlevel 1 (
 echo Missing: Git >> "%radarCheck%"
 goto missing
)
where gh >nul 2>nul
if errorlevel 1 (
 echo Missing: GitHub CLI >> "%radarCheck%"
 goto missing
)
gh auth status >nul 2>nul
if errorlevel 1 (
 echo GitHub login required: run gh auth login >> "%radarCheck%"
 goto missing
)
echo Required commands and GitHub login found. >> "%radarCheck%"
if not exist "%radarSource%\.git" (
 git clone https://github.com/yasuyasu55/pokemon-radar-mobile.git "%radarSource%"
 if errorlevel 1 (
  echo Clone failed. Existing files were not removed. >> "%radarCheck%"
  goto missing
 )
)
cd /d "%radarSource%"
call tools\pc-collector\RUN-PC-COLLECTOR.cmd
exit /b
:missing
type "%radarCheck%"
echo Send pc-check.txt for diagnosis. No collection was started.
start "" notepad.exe "%radarCheck%"
pause
