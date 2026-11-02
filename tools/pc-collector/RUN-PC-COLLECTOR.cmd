@echo off
setlocal
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 goto missing
where git >nul 2>nul
if errorlevel 1 goto missing
where gh >nul 2>nul
if errorlevel 1 goto missing
gh auth status
if errorlevel 1 goto done
node -e "import('playwright').catch(()=>process.exit(1))"
if errorlevel 1 (
 call npm install --no-save --package-lock=false playwright@1.55.0
 if errorlevel 1 goto done
)
call npx playwright install chromium
if errorlevel 1 goto done
node tools\pc-collector\run.mjs
goto done
:missing
echo Install Node.js 22 or newer, Git, and GitHub CLI first.
echo Use gh auth login for your GitHub account. Do not paste tokens into files.
:done
pause
