@echo off
chcp 65001 >nul
node "%~dp0diagnose-crawl-storm-entry.mjs"
echo.
echo Finished. Check Desktop\pokemon-radar-crawl-storm-diagnose\crawl-storm-entry-report.json
pause
