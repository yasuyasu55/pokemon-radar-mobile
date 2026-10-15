# Tests with FAKE registrations (no real Windows, no registry). Run: pwsh -File test-autostart-tool.ps1
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('at-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$env:LOCALAPPDATA = $root; $env:USERPROFILE = $root
. (Join-Path $PSScriptRoot 'disable-pokemon-radar-autostart.ps1') -NoMain

$pass = 0; $fail = 0
function Check([string]$n, [bool]$ok) { if ($ok) { $script:pass++; Write-Host "PASS $n" } else { $script:fail++; Write-Host "FAIL $n" -ForegroundColor Red } }

# fake folders
$app = Join-Path $root 'Desktop/pokemon-radar'; New-Item -ItemType Directory -Path $app -Force | Out-Null
Set-Content (Join-Path $app 'package.json') '{ "name": "pokemon-radar", "version": "0.7.0" }'
Set-Content (Join-Path $app 'start-pokemon-radar.bat') "@echo off`r`ncd /d %~dp0`r`nnode next dev -H 127.0.0.1"
New-Item -ItemType Directory -Path (Join-Path $app 'node_modules/next/dist/bin') -Force | Out-Null; Set-Content (Join-Path $app 'node_modules/next/dist/bin/next') 'x'
$other = Join-Path $root 'Desktop/zaiko-tool'; New-Item -ItemType Directory -Path $other -Force | Out-Null
Set-Content (Join-Path $other 'package.json') '{ "name": "zaiko-tool" }'
Set-Content (Join-Path $other 'run.bat') "@echo off`r`nnode server.js"
# wrappers
New-Item -ItemType Directory -Path (Join-Path $other 'node_modules/next/dist/bin') -Force | Out-Null; Set-Content (Join-Path $other 'node_modules/next/dist/bin/next') 'x'
$wComment = Join-Path $root 'Desktop/wrap-comment.cmd'
Set-Content $wComment "rem this used to start pokemon-radar on 127.0.0.1:3000`r`necho pokemon-radar is not started here`r`nstart `"`" $other/run.bat"
$wShared = Join-Path $root 'Desktop/wrap-shared.cmd'
Set-Content $wShared "start `"`" $app/start-pokemon-radar.bat`r`nstart `"`" $other/run.bat"
$wReal = Join-Path $root 'Desktop/wrap-real.cmd'
Set-Content $wReal "@echo off`r`nrem launcher`r`ncall $app/start-pokemon-radar.bat"
$wEchoOnly = Join-Path $root 'Desktop/wrap-echo.cmd'
Set-Content $wEchoOnly "echo starting $app/start-pokemon-radar.bat later`r`nexit /b 0"

function Task($path, $name, $exe, $argv, $wd, $state = 'Ready', $trig = 1) {
  @{ TaskPath = $path; TaskName = $name; State = $state; TriggerCount = $trig; Actions = @(@{ Execute = $exe; Arguments = $argv; WorkingDirectory = $wd }) }
}
$script:tasks = @(
  (Task '\' 'T-direct'   'cmd.exe' "/c `"$app/start-pokemon-radar.bat`"" ''),
  (Task '\' 'T-cwd'      'node' 'node_modules/next/dist/bin/next dev' $app),
  (Task '\' 'T-wrapreal' $wReal '' ''),
  (Task '\' 'T-comment'  $wComment '' ''),
  (Task '\' 'T-echoonly' $wEchoOnly '' ''),
  (Task '\' 'T-shared'   $wShared '' ''),
  (Task '\' 'T-missing'  'cmd.exe' '/c C:\nowhere\pokemon-radar\start.bat' ''),
  (Task '\' 'PublisherJob' 'cmd.exe' '/c something-unknown.bat' ''),
  (Task '\' 'Other'      $other 'x' ''),
  (Task '\' 'T-disabled' 'cmd.exe' "/c `"$app/start-pokemon-radar.bat`"" '' 'Disabled')
)
$script:runVals = @{}
$script:runVals['HKCU:\Run|PokeRun'] = @{ Data = "$app/start-pokemon-radar.bat"; Kind = 'String' }
$script:runVals['HKCU:\Run|CommentRun'] = @{ Data = "cmd /c rem pokemon-radar"; Kind = 'String' }
$script:calls = @()
$script:failExportFor = ''
$script:startupDir = Join-Path $root 'Startup'; New-Item -ItemType Directory -Path $script:startupDir | Out-Null

function New-FakeEnv {
  @{
    ListTasks = { $script:tasks }
    ExportTaskXml = { param($p, $n) if ($n -eq $script:failExportFor) { throw 'simulated export failure' }; "<Task>$n xml content</Task>" }
    DisableTask = { param($p, $n) $script:calls += "disable:$n"; foreach ($t in $script:tasks) { if ($t.TaskName -eq $n) { $t.State = 'Disabled' } } }
    EnableTask = { param($p, $n) $script:calls += "enable:$n"; foreach ($t in $script:tasks) { if ($t.TaskName -eq $n) { $t.State = 'Ready' } } }
    GetTaskState = { param($p, $n) foreach ($t in $script:tasks) { if ($t.TaskName -eq $n) { return $t.State } }; return $null }
    StartupDirs = { @(@{ Scope = 'User'; Path = $script:startupDir }) }
    ResolveLnk = { param($p) @{ Target = ''; Args = ''; WorkDir = '' } }
    RunKeys = { @('HKCU:\Run') }
    ListRunValues = { param($k) foreach ($key in $script:runVals.Keys) { if ($key.StartsWith($k + '|')) { @{ Name = $key.Split('|')[1]; Data = $script:runVals[$key].Data; Kind = $script:runVals[$key].Kind } } } }
    GetRunValue = { param($k, $n) $script:runVals["$k|$n"] }
    RemoveRunValue = { param($k, $n) $script:calls += "runremove:$n"; $script:runVals.Remove("$k|$n") }
    SetRunValue = { param($k, $n, $d, $kind) $script:calls += "runset:$n"; $script:runVals["$k|$n"] = @{ Data = $d; Kind = $kind } }
    ListNodeProcs = { @(@{ Pid = 1; CommandLine = "node $app/node_modules/next/dist/bin/next dev" }, @{ Pid = 2; CommandLine = "node $other/node_modules/next/dist/bin/next dev" }) }
    StopProc = { param($i) $script:calls += "stop:$i" }
  }
}

# ---- classification
$Env = New-FakeEnv
$regs = @(Find-Registrations $Env @())
function ClassOf($name) { ($regs | Where-Object { $_.TaskName -eq $name -or $_.Name -eq $name } | Select-Object -First 1).Class }
Check 'direct bat in app folder = CONFIRMED' ((ClassOf 'T-direct') -eq 'CONFIRMED')
Check 'working dir in app folder = CONFIRMED' ((ClassOf 'T-cwd') -eq 'CONFIRMED')
Check 'wrapper that really calls app bat = CONFIRMED' ((ClassOf 'T-wrapreal') -eq 'CONFIRMED')
Check 'wrapper mentioning app only in rem/echo = POSSIBLE (not CONFIRMED)' ((ClassOf 'T-comment') -eq 'POSSIBLE')
Check 'wrapper with app path only inside echo = POSSIBLE' ((ClassOf 'T-echoonly') -eq 'POSSIBLE')
Check 'wrapper launching app AND other tool = SHARED' ((ClassOf 'T-shared') -eq 'SHARED')
Check 'missing path with app name = POSSIBLE' ((ClassOf 'T-missing') -eq 'POSSIBLE')
Check 'Publisher-like name without evidence = POSSIBLE' ((ClassOf 'PublisherJob') -eq 'POSSIBLE')
Check 'unrelated other tool task not listed' (-not ($regs | Where-Object { $_.TaskName -eq 'Other' }))
Check 'Run value launching app bat = CONFIRMED' ((ClassOf 'PokeRun') -eq 'CONFIRMED')
Check 'Run value with rem text only = POSSIBLE' ((ClassOf 'CommentRun') -eq 'POSSIBLE')
$running = @(Find-RunningApp $Env)
Check 'running detection only app folder process' ($running.Count -eq 1 -and $running[0].Pid -eq 1)
$ap = @(Find-Registrations $Env @('\PublisherJob'))
Check '-AlsoTask promotes POSSIBLE task only when named' ((($ap | Where-Object { $_.TaskName -eq 'PublisherJob' }).Class -eq 'CONFIRMED') -and (($ap | Where-Object { $_.TaskName -eq 'T-comment' }).Class -eq 'POSSIBLE'))

# ---- backup folder unusable -> nothing changes
$fileAsDir = Join-Path $root 'iamafile'; Set-Content $fileAsDir 'x'
$script:calls = @()
$r = Invoke-ApplyRegs $Env $regs $running (Join-Path $fileAsDir 'sub') $false
Check 'unwritable backup folder aborts' ($r.Aborted -eq $true)
Check 'unwritable backup folder -> zero change calls' ($script:calls.Count -eq 0)
$sum = (Get-ApplySummary $r $regs) -join "`n"
Check 'summary does not claim it will not start' ($sum -notmatch '(?i)will not start( at| next)' -and $sum -match 'NOT guaranteed')

# ---- one target's backup fails -> that target untouched, others done, journal per change
$bd = Join-Path $root 'bk1'
$script:calls = @(); $script:failExportFor = 'T-cwd'
$r = Invoke-ApplyRegs $Env $regs $running $bd $false
Check 'failed-backup target not disabled' (($script:calls -notcontains 'disable:T-cwd') -and (($script:tasks | Where-Object TaskName -eq 'T-cwd').State -eq 'Ready'))
Check 'other CONFIRMED targets disabled' (($script:calls -contains 'disable:T-direct') -and ($script:calls -contains 'disable:T-wrapreal') -and ($script:calls -contains 'runremove:PokeRun'))
Check 'POSSIBLE/SHARED never touched' (($script:calls -notcontains 'disable:T-comment') -and ($script:calls -notcontains 'disable:T-shared') -and ($script:calls -notcontains 'disable:PublisherJob') -and ($script:calls -notcontains 'runremove:CommentRun'))
Check 'already-disabled task not re-touched' ($script:calls -notcontains 'disable:T-disabled')
Check 'counts: NotChanged>=1, Failed=0' ($r.NotChanged -ge 1 -and $r.Failed -eq 0)
$j = @(Get-JournalState $bd)
Check 'journal has done records per change' (@($j | Where-Object Status -eq 'done').Count -eq 3)
Check 'no journal record for failed-backup target' (-not ($j | Where-Object { $_.TaskName -eq 'T-cwd' }))
$sum = (Get-ApplySummary $r $regs) -join "`n"
Check 'summary lists left-over POSSIBLE/SHARED + unscanned areas' ($sum -match 'left unchanged' -and $sum -match 'NOT SCANNED')

# ---- journal write failure before change -> not changed (simulate by making journal path a directory)
$bd2 = Join-Path $root 'bk2'; New-Item -ItemType Directory -Path $bd2 | Out-Null
New-Item -ItemType Directory -Path (Join-Path $bd2 'journal.jsonl') | Out-Null
$script:calls = @()
$r = Invoke-ApplyRegs $Env $regs $running $bd2 $false
Check 'journal unwritable -> abort, zero changes' ($r.Aborted -and $script:calls.Count -eq 0)

# ---- restore conflict: Run value re-created by someone with different data
$script:runVals['HKCU:\Run|PokeRun'] = @{ Data = 'C:\other\thing.exe'; Kind = 'String' }
$script:calls = @()
$rr = Invoke-RestoreFrom $Env $bd
Check 'restore conflict reported and stops' ($rr.Ok -eq $false -and $rr.Conflicts.Count -ge 1)
Check 'restore conflict -> nothing restored, existing value untouched' ($script:calls.Count -eq 0 -and $script:runVals['HKCU:\Run|PokeRun'].Data -eq 'C:\other\thing.exe')

# ---- restore normal
$script:runVals.Remove('HKCU:\Run|PokeRun')
$rr = Invoke-RestoreFrom $Env $bd
Check 'restore ok' ($rr.Ok -eq $true -and $rr.Restored -eq 3)
Check 'tasks re-enabled and Run value back with original data' ((($script:tasks | Where-Object TaskName -eq 'T-direct').State -eq 'Ready') -and $script:runVals['HKCU:\Run|PokeRun'].Data -eq "$app/start-pokemon-radar.bat")

# ---- startup item: copy+hash then remove; restore refuses to overwrite
$sf = Join-Path $script:startupDir 'radar.bat'; Set-Content $sf "call $app/start-pokemon-radar.bat"
$script:tasks = @(); $script:runVals = @{}
$regs2 = @(Find-Registrations $Env @())
Check 'startup bat calling app = CONFIRMED' (($regs2 | Where-Object Kind -eq 'Startup').Class -eq 'CONFIRMED')
$bd3 = Join-Path $root 'bk3'
$r = Invoke-ApplyRegs $Env $regs2 @() $bd3 $false
Check 'startup item moved after verified backup' ((-not (Test-Path $sf)) -and $r.Changed -eq 1)
Set-Content $sf 'user made a new file here'
$rr = Invoke-RestoreFrom $Env $bd3
Check 'startup restore refuses to overwrite existing file' ($rr.Ok -eq $false -and (Get-Content $sf) -eq 'user made a new file here')
Remove-Item $sf
$rr = Invoke-RestoreFrom $Env $bd3
Check 'startup restore ok when path free' ($rr.Ok -and (Test-Path $sf))

# ---- v3: Japanese paths and file encodings
$jp = [string][char]0x81EA + [char]0x793E + [char]0x958B + [char]0x767A
$jpApp = Join-Path $root ($jp + ' folder/pokemon-radar')
New-Item -ItemType Directory -Path $jpApp -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $jpApp 'package.json'), '{"name":"pokemon-radar"}', (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText((Join-Path $jpApp 'start.cmd'), '@echo off', (New-Object Text.UTF8Encoding($false)))
$jpWrapper = Join-Path $root 'jp-wrapper.cmd'
$jpText = 'call "' + (Join-Path $jpApp 'start.cmd') + '"'
foreach ($encoding in @((New-Object Text.UTF8Encoding($false)), [Text.Encoding]::Unicode, [Text.Encoding]::GetEncoding(932))) {
  [IO.File]::WriteAllText($jpWrapper, $jpText, $encoding)
  Check ('Japanese path read: ' + $encoding.WebName) ((Read-TextSafe $jpWrapper) -eq $jpText)
  Check ('Japanese wrapper confirmed: ' + $encoding.WebName) ((Get-Classification @($jpWrapper) '' '').Class -eq 'CONFIRMED')
}

# ---- v3: a task disabled successfully but post-change inspection throws
$script:tasks = @((Task '\' 'PartialTask' 'cmd.exe' ("/c `"$app/start-pokemon-radar.bat`"") ''))
$script:runVals = @{}; $script:failExportFor = ''; Remove-Item $sf -ErrorAction SilentlyContinue
$Env = New-FakeEnv
$script:failNextStateRead = $true
$Env.GetTaskState = { param($p, $n) if ($script:failNextStateRead) { $script:failNextStateRead = $false; throw 'post-disable inspection failed' }; foreach ($t in $script:tasks) { if ($t.TaskName -eq $n) { return $t.State } }; return $null }
$regs = @(Find-Registrations $Env @()); $bd4 = Join-Path $root 'bk4'
$r = Invoke-ApplyRegs $Env $regs @() $bd4 $false
Check 'task changed but inspection failed is recorded as failed' ($r.Failed -eq 1 -and $script:tasks[0].State -eq 'Disabled' -and (@(Get-JournalState $bd4 | Where-Object Status -eq 'failed')).Count -eq 1)
$rr = Invoke-RestoreFrom $Env $bd4
Check 'failed task is restored after reconciling real state' ($rr.Ok -and $rr.Restored -eq 1 -and $script:tasks[0].State -eq 'Ready')

# ---- v3: Run removal succeeds before adapter reports failure
$script:tasks = @(); $script:runVals = @{'HKCU:\Run|PokeRun' = @{ Data = "$app/start-pokemon-radar.bat"; Kind = 'String' }}
$Env = New-FakeEnv
$Env.RemoveRunValue = { param($k, $n) $script:runVals.Remove("$k|$n"); throw 'post-remove failure' }
$regs = @(Find-Registrations $Env @()); $bd5 = Join-Path $root 'bk5'
$r = Invoke-ApplyRegs $Env $regs @() $bd5 $false
Check 'Run removed but failure recorded' ($r.Failed -eq 1 -and -not $script:runVals['HKCU:\Run|PokeRun'])
$rr = Invoke-RestoreFrom $Env $bd5
Check 'failed Run removal remains recoverable' ($rr.Ok -and $rr.Restored -eq 1 -and $script:runVals['HKCU:\Run|PokeRun'].Data -eq "$app/start-pokemon-radar.bat")

# ---- v3: startup removal succeeds but writing done fails
$script:tasks = @(); $script:runVals = @{}; Set-Content $sf "call $app/start-pokemon-radar.bat"
$Env = New-FakeEnv; $regs = @(Find-Registrations $Env @()); $bd6 = Join-Path $root 'bk6'
$script:savedAddJournal = (Get-Item Function:\Add-Journal).ScriptBlock
Set-Item Function:\Add-Journal { param($bd, $rec) if ($rec.Status -eq 'done') { throw 'done journal write failed' }; & $script:savedAddJournal $bd $rec }
$r = Invoke-ApplyRegs $Env $regs @() $bd6 $false
Set-Item Function:\Add-Journal $script:savedAddJournal
Check 'startup removed with failed done record' ($r.Failed -eq 1 -and -not (Test-Path $sf))
$rr = Invoke-RestoreFrom $Env $bd6
Check 'failed startup change can be restored' ($rr.Ok -and $rr.Restored -eq 1 -and (Test-Path $sf))

# ---- v3: corrupt backup blocks restore BEFORE writing original
$regs = @(Find-Registrations $Env @()); $bd7 = Join-Path $root 'bk7'
$r = Invoke-ApplyRegs $Env $regs @() $bd7 $false
$record = Get-JournalState $bd7 | Where-Object Kind -eq 'Startup'
Set-Content -LiteralPath $record.BackupPath 'corrupt bytes'
$rr = Invoke-RestoreFrom $Env $bd7
Check 'corrupt startup backup stops restore without creating original' (-not $rr.Ok -and -not (Test-Path $sf))

# ---- v3: changed task action is never re-enabled by Restore
$script:tasks = @((Task '\' 'ChangedTask' 'cmd.exe' ("/c `"$app/start-pokemon-radar.bat`"") ''))
$Env = New-FakeEnv; $regs = @(Find-Registrations $Env @()); $bd8 = Join-Path $root 'bk8'
$r = Invoke-ApplyRegs $Env $regs @() $bd8 $false
$script:tasks[0].Actions[0].Arguments = '/c other-tool.cmd'
$script:calls = @(); $rr = Invoke-RestoreFrom $Env $bd8
Check 'changed task action causes preflight conflict with zero changes' (-not $rr.Ok -and $script:calls.Count -eq 0 -and $script:tasks[0].State -eq 'Disabled')

# ---- v3: reject deletion when a Run value changed since Check
$script:tasks = @(); $script:runVals = @{'HKCU:\Run|PokeRun' = @{ Data = "$app/start-pokemon-radar.bat"; Kind = 'String' }}
$Env = New-FakeEnv; $regs = @(Find-Registrations $Env @())
$script:runVals['HKCU:\Run|PokeRun'].Data = 'C:\unrelated.exe'
$r = Invoke-ApplyRegs $Env $regs @() (Join-Path $root 'bk9') $false
Check 'changed Run value is not removed' ($r.Changed -eq 0 -and $script:runVals['HKCU:\Run|PokeRun'].Data -eq 'C:\unrelated.exe')

Write-Host "`nPASS=$pass FAIL=$fail"
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
exit ($(if ($fail -eq 0) { 0 } else { 1 }))

