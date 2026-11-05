@echo off
setlocal
chcp 65001 >nul
set "radarState=%LOCALAPPDATA%\PokemonRadarCollector"
set "radarReport=%TEMP%\PokemonRadar-PC-CHECK.txt"
(
 echo POKEMON RADAR - READ ONLY PC CHECK
 echo No collection, task changes, Git updates or network requests are performed.
 echo CHECK TIME: %date% %time%
 echo.
 echo === Scheduled task ===
 schtasks /Query /TN "\PokemonRadar-PC-Collector-Daily" /V /FO LIST
 echo.
 echo === Commands visible in this interactive session ===
 where node
 where git
 where gh
 echo.
 echo === Collector result and launcher logs ===
 powershell.exe -NoProfile -Command "$root=Join-Path $env:LOCALAPPDATA 'PokemonRadarCollector'; foreach($name in @('last-result.json','daily-launcher.log','daily-error.log')) { $p=Join-Path $root $name; Write-Output ('--- '+$name+' ---'); if(Test-Path -LiteralPath $p) { $f=Get-Item -LiteralPath $p; Write-Output ('Modified: '+$f.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')); if($name -eq 'last-result.json') { $lines=Get-Content -LiteralPath $p -Encoding UTF8 } else { $lines=Get-Content -LiteralPath $p -Tail 25 -Encoding UTF8 }; foreach($line in $lines) { $line -replace '(?i)(gh[pousr]_[a-z0-9_]+|github_pat_[a-z0-9_]+)','[REDACTED]' -replace '(?i)(Bearer\s+)\S+','$1[REDACTED]' } } else { Write-Output 'NOT FOUND' } }; Write-Output '--- Recent daily markers ---'; $days=Join-Path $root 'daily'; if(Test-Path -LiteralPath $days) { Get-ChildItem -LiteralPath $days -Filter '*.json' | Sort-Object Name -Descending | Select-Object -First 3 Name,LastWriteTime | Format-Table -AutoSize }"
) > "%radarReport%" 2>&1
echo Read-only check finished. Send the opened report in this chat.
start "" notepad.exe "%radarReport%"
endlocal
