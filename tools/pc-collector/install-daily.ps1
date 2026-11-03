param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$taskName = 'PokemonRadar-PC-Collector-Daily'
$runner = Join-Path $PSScriptRoot 'daily-run.ps1'
$state = Join-Path $env:LOCALAPPDATA 'PokemonRadarCollector'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$old = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
if ($old -and (@($old.Actions).Count -ne 1 -or $old.Actions[0].Arguments -notlike ('*"' + $runner + '"*'))) { throw 'Same-name task has a different action. No change made.' }
if ($Disable) {
    if ($old) { Disable-ScheduledTask -TaskName $taskName -TaskPath '\' | Out-Null }
    Write-Host 'Disabled only PokemonRadar-PC-Collector-Daily.'
    exit 0
}
if (-not (Test-Path -LiteralPath $runner)) { throw 'Runner missing' }
if ([TimeZoneInfo]::Local.Id -ne 'Tokyo Standard Time') { throw 'Windows timezone must be Japan for the 09:15 schedule. No settings changed.' }
if ($old) {
    $backup = Join-Path $state ('daily-task-before-{0}.xml' -f (Get-Date -Format 'yyyyMMdd-HHmmssfff'))
    Export-ScheduledTask -TaskName $taskName -TaskPath '\' | Set-Content -LiteralPath $backup -Encoding Unicode
    [xml](Get-Content -LiteralPath $backup -Raw) | Out-Null
}
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File "' + $runner + '"') -WorkingDirectory ([IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..')))
$triggers = @((New-ScheduledTaskTrigger -AtLogOn -User $user),(New-ScheduledTaskTrigger -Daily -At '09:15'))
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'X sample + Amazon + Rakuten collector; once per JST day; no Next.js app.' -Force | Out-Null
$check = Get-ScheduledTask -TaskName $taskName -TaskPath '\'
if ($check.State -eq 'Disabled' -or $check.Actions[0].Arguments -notlike ('*"' + $runner + '"*') -or @($check.Triggers).Count -ne 2) { throw 'Registration verification failed' }
Write-Host 'REGISTERED: PokemonRadar-PC-Collector-Daily'
Write-Host 'Runs at user logon or 09:15 Japan time; collector attempts only once per JST date.'
Write-Host 'Chrome windows will open during collection. No Next.js app is started.'
Write-Host 'Not executed now. Verify at your next normal login. PC must be on and logged in.'
