<#
POKEMON RADAR - Windows auto-start disabler v3
NOT APPLIED TO THE USER'S PC. Fake registrations are used in the automated tests.

Modes (default Check changes nothing):
  Check          List related registrations and how each one was classified.
  Apply          Disable ONLY items classified CONFIRMED (plus tasks you name with -AlsoTask).
  Restore        Undo what Apply recorded in journal.jsonl. Stops without changes if anything conflicts.
  MobileShortcut Create a desktop shortcut that opens the public mobile URL.

Classification (never by a comment, a message text, a task name, or a port alone):
  CONFIRMED  The launch target (Execute / Arguments / WorkingDirectory / shortcut target / Run command, or the
             non-comment launch lines of a wrapper .cmd/.bat/.vbs/.ps1 it starts) points to an EXISTING path
             inside a folder whose package.json says "name": "pokemon-radar".
  SHARED     Same as CONFIRMED but the same launcher also starts other tools. Never changed.
  POSSIBLE   Mentions pokemon-radar / 127.0.0.1:3000 only in comments, messages, names or missing paths. Never
             changed unless you approve a task by name with -AlsoTask "\Folder\TaskName" after reading it.
Nothing is deleted except a Startup file that was first copied to the backup folder and hash-verified.
#>
param(
  [ValidateSet('Check','Apply','Restore','MobileShortcut')][string]$Mode = 'Check',
  [string]$ProjectRoot = '',
  [string]$BackupDir = '',
  [string[]]$AlsoTask = @(),
  [switch]$StopRunning,
  [switch]$NoMain
)

$ErrorActionPreference = 'Continue'
$script:MobileUrl = 'https://yasuyasu55.github.io/pokemon-radar-mobile/'
$script:BackupBase = Join-Path $env:LOCALAPPDATA 'PokemonRadar-AutostartBackup'
$script:PokeRegex = '(?i)pokemon[-_ ]?radar'
$script:LocalAppRegex = '127\.0\.0\.1:3000|localhost:3000'
$script:OtherToolRegex = '(?i)zaiko|mimamori|tennis|line-?bot|ea-?shirei|shigetool'
$script:PublisherNameRegex = '(?i)publish|radar|amazon'
$script:Sep = [IO.Path]::DirectorySeparatorChar
$script:WrapperExt = @('.cmd', '.bat', '.vbs', '.ps1')

# ------------------------------------------------------------------ text helpers
function Read-TextSafe([string]$path) {
  try {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return '' }
    if ((Get-Item -LiteralPath $path).Length -gt 262144) { return '' }
    $bytes = [IO.File]::ReadAllBytes($path)
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 255 -and $bytes[1] -eq 254) { return [Text.Encoding]::Unicode.GetString($bytes, 2, $bytes.Length - 2) }
    if ($bytes.Length -ge 2 -and $bytes[0] -eq 254 -and $bytes[1] -eq 255) { return [Text.Encoding]::BigEndianUnicode.GetString($bytes, 2, $bytes.Length - 2) }
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { return [Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3) }
    try { return (New-Object Text.UTF8Encoding($false, $true)).GetString($bytes) }
    catch { return [Text.Encoding]::GetEncoding(932).GetString($bytes) }
  } catch { return '' }
}

function Remove-LineComment([string]$line, [char]$marker) {
  $inD = $false; $inS = $false
  for ($i = 0; $i -lt $line.Length; $i++) {
    $c = $line[$i]
    if ($c -eq [char]34 -and -not $inS) { $inD = -not $inD }
    elseif ($c -eq [char]39 -and $marker -ne [char]39 -and -not $inD) { $inS = -not $inS }
    elseif ($c -eq $marker -and -not $inD -and -not $inS) { return $line.Substring(0, $i) }
  }
  return $line
}

# Returns only lines that can launch something: comments and pure output lines (echo / Write-Host / MsgBox ...) are removed.
function Get-LaunchText([string]$raw, [string]$ext) {
  $t = $raw -replace "`r", ''
  $ext = $ext.ToLower()
  if ($ext -eq '.ps1') { $t = [regex]::Replace($t, '(?s)<#.*?#>', '') }
  $keep = @()
  foreach ($l in ($t -split "`n")) {
    $x = $l
    if ($ext -eq '.cmd' -or $ext -eq '.bat') {
      if ($x -match '^\s*@?(rem(\s|$)|::)') { $x = '' }
    } elseif ($ext -eq '.vbs') {
      if ($x -match '^\s*rem(\s|$)') { $x = '' } else { $x = Remove-LineComment $x ([char]39) }
    } elseif ($ext -eq '.ps1') {
      $x = Remove-LineComment $x ([char]35)
    }
    if ($x -match '^\s*@?(echo|write-host|write-output|write-warning|wscript\.echo|msgbox)\b') { $x = '' }
    if ($x.Trim().Length -gt 0) { $keep += $x }
  }
  return ($keep -join "`n")
}

# Existing file/folder paths mentioned in a launch text.
function Get-ExistingPaths([string]$text, [string]$baseDir, [string]$selfDir) {
  $found = New-Object System.Collections.ArrayList
  $t = [Environment]::ExpandEnvironmentVariables($text)
  if ($selfDir) { $t = $t.Replace('%~dp0', ($selfDir.TrimEnd('\', '/') + $script:Sep)) }
  $rx = '(?:[A-Za-z]:[\\/]|/[^\s"''/]+/)[^"''<>|*?\r\n]*'
  foreach ($m in [regex]::Matches($t, $rx)) {
    $cand = $m.Value.Trim().TrimEnd('.', ',', ';', ')')
    for ($i = 0; $i -lt 15 -and $cand.Length -gt 3; $i++) {
      if (Test-Path -LiteralPath $cand) { [void]$found.Add($cand); break }
      $idx = $cand.LastIndexOf(' ')
      if ($idx -lt 3) { break }
      $cand = $cand.Substring(0, $idx).TrimEnd()
    }
  }
  if ($baseDir) {
    foreach ($m in [regex]::Matches($t, '[A-Za-z0-9_.\-]+\.(?:bat|cmd|ps1|vbs)')) {
      $p = Join-Path $baseDir $m.Value
      if (Test-Path -LiteralPath $p -PathType Leaf) { [void]$found.Add($p) }
    }
  }
  return @($found | Select-Object -Unique)
}

# Folder (or $null) that really is the POKEMON RADAR app: an ancestor containing package.json with "name": "pokemon-radar".
function Find-PokemonRoot([string]$p) {
  $d = $p
  if (Test-Path -LiteralPath $p -PathType Leaf) { $d = Split-Path -Parent $p }
  for ($i = 0; $i -lt 8 -and $d; $i++) {
    $pj = Join-Path $d 'package.json'
    if (Test-Path -LiteralPath $pj -PathType Leaf) {
      if ((Read-TextSafe $pj) -match '"name"\s*:\s*"pokemon-radar"') { return $d }
    }
    $parent = Split-Path -Parent $d
    if (-not $parent -or $parent -eq $d) { break }
    $d = $parent
  }
  return $null
}

# Evidence from launch fields. Wrappers are followed (depth <= 4) and only their non-comment launch lines count.
function Get-Evidence([string[]]$fields, [string]$baseDir, [string]$selfDir, [hashtable]$visited, [int]$depth) {
  $ev = @{ Roots = @(); Other = $false; Mention = $false; Wrappers = @() }
  foreach ($f in $fields) {
    if (-not $f) { continue }
    if ($f -match $script:PokeRegex -or $f -match $script:LocalAppRegex) { $ev.Mention = $true }
    if ($f -match $script:OtherToolRegex) { $ev.Other = $true }
    foreach ($p in (Get-ExistingPaths $f $baseDir $selfDir)) {
      $root = Find-PokemonRoot $p
      if ($root) { $ev.Roots += $root }
      $ext = [IO.Path]::GetExtension($p).ToLower()
      if ((Test-Path -LiteralPath $p -PathType Leaf) -and ($script:WrapperExt -contains $ext) -and $depth -lt 4) {
        $key = $p.ToLower()
        if ($visited.ContainsKey($key)) { continue }
        $visited[$key] = $true
        $raw = Read-TextSafe $p
        if ($raw -match $script:PokeRegex -or $raw -match $script:LocalAppRegex) { $ev.Mention = $true }
        $ev.Wrappers += $p
        $dir = Split-Path -Parent $p
        $sub = Get-Evidence @((Get-LaunchText $raw $ext)) $dir $dir $visited ($depth + 1)
        $ev.Roots += $sub.Roots
        if ($sub.Other) { $ev.Other = $true }
        if ($sub.Mention) { $ev.Mention = $true }
        $ev.Wrappers += $sub.Wrappers
      }
    }
  }
  $ev.Roots = @($ev.Roots | Select-Object -Unique)
  return $ev
}

function Get-Classification([string[]]$fields, [string]$baseDir, [string]$nameHint) {
  $ev = Get-Evidence $fields $baseDir '' @{} 0
  $class = 'UNRELATED'
  $why = ''
  if ($ev.Roots.Count -gt 0) {
    if ($ev.Other) { $class = 'SHARED'; $why = 'starts POKEMON RADAR and other tools' }
    else { $class = 'CONFIRMED'; $why = 'launch target is inside ' + $ev.Roots[0] }
  } elseif ($ev.Mention) { $class = 'POSSIBLE'; $why = 'mentions pokemon-radar / 127.0.0.1:3000 but no existing launch target inside the app folder was found' }
  elseif ($nameHint -and $nameHint -match $script:PublisherNameRegex) { $class = 'POSSIBLE'; $why = 'name looks related, no launch evidence' }
  return @{ Class = $class; Why = $why; Wrappers = @($ev.Wrappers | Select-Object -Unique) }
}

# ------------------------------------------------------------------ adapter (real Windows implementation)
function New-RealAdapter {
  return @{
    ListTasks = {
      $res = @()
      foreach ($t in (Get-ScheduledTask -ErrorAction Stop)) {
        if ($t.TaskPath -like '\Microsoft\*') { continue }
        $acts = @()
        foreach ($a in $t.Actions) { $acts += @{ Execute = [string]$a.Execute; Arguments = [string]$a.Arguments; WorkingDirectory = [string]$a.WorkingDirectory } }
        $res += @{ TaskPath = [string]$t.TaskPath; TaskName = [string]$t.TaskName; State = [string]$t.State; TriggerCount = @($t.Triggers).Count; Actions = $acts }
      }
      return $res
    }
    ExportTaskXml = { param($path, $name) return ([string](Export-ScheduledTask -TaskName $name -TaskPath $path | Out-String)) }
    DisableTask = { param($path, $name) Disable-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction Stop | Out-Null }
    EnableTask = { param($path, $name) Enable-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction Stop | Out-Null }
    GetTaskState = { param($path, $name) $x = Get-ScheduledTask -TaskName $name -TaskPath $path -ErrorAction SilentlyContinue; if ($x) { return [string]$x.State } else { return $null } }
    StartupDirs = { return @(@{ Scope = 'User'; Path = [Environment]::GetFolderPath('Startup') }, @{ Scope = 'Common'; Path = [Environment]::GetFolderPath('CommonStartup') }) }
    ResolveLnk = {
      param($path)
      $sh = New-Object -ComObject WScript.Shell
      $l = $sh.CreateShortcut($path)
      return @{ Target = [string]$l.TargetPath; Args = [string]$l.Arguments; WorkDir = [string]$l.WorkingDirectory }
    }
    RunKeys = { return @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run') }
    ListRunValues = {
      param($key)
      $res = @()
      if (-not (Test-Path -LiteralPath $key)) { return $res }
      $item = Get-Item -LiteralPath $key
      foreach ($n in $item.GetValueNames()) {
        $raw = $item.GetValue($n, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
        $res += @{ Name = [string]$n; Data = [string]$raw; Kind = [string]$item.GetValueKind($n) }
      }
      return $res
    }
    GetRunValue = {
      param($key, $name)
      if (-not (Test-Path -LiteralPath $key)) { return $null }
      $item = Get-Item -LiteralPath $key
      if (-not ($item.GetValueNames() -contains $name)) { return $null }
      return @{ Data = [string]$item.GetValue($name, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames); Kind = [string]$item.GetValueKind($name) }
    }
    RemoveRunValue = { param($key, $name) Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction Stop }
    SetRunValue = {
      param($key, $name, $data, $kind)
      if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
      New-ItemProperty -LiteralPath $key -Name $name -Value $data -PropertyType $kind -Force | Out-Null
    }
    ListNodeProcs = {
      $res = @()
      foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)) { $res += @{ Pid = [int]$p.ProcessId; CommandLine = [string]$p.CommandLine } }
      return $res
    }
    StopProc = { param($procId) Stop-Process -Id $procId -ErrorAction Stop }
  }
}

# ------------------------------------------------------------------ discovery
function Find-Registrations($Env, [string[]]$AlsoTaskNames) {
  $out = @()
  $approved = @($AlsoTaskNames | ForEach-Object { $_.ToLower() })

  foreach ($t in @(& $Env.ListTasks)) {
    $fields = @(); $wd = ''; $disp = @()
    foreach ($a in $t.Actions) {
      $fields += $a.Execute; $fields += $a.Arguments; $fields += $a.WorkingDirectory
      if ($a.WorkingDirectory) { $wd = [Environment]::ExpandEnvironmentVariables($a.WorkingDirectory) }
      $disp += (($a.Execute + ' ' + $a.Arguments).Trim() + ' [cwd ' + $a.WorkingDirectory + ']')
    }
    $c = Get-Classification $fields $wd $t.TaskName
    if ($c.Class -eq 'UNRELATED') { continue }
    $full = ($t.TaskPath + $t.TaskName)
    $userApproved = $false
    if ($c.Class -eq 'POSSIBLE' -and ($approved -contains $full.ToLower())) { $c.Class = 'CONFIRMED'; $c.Why = 'approved by user with -AlsoTask'; $userApproved = $true }
    $out += @{ Kind = 'Task'; Class = $c.Class; Why = $c.Why; Wrappers = $c.Wrappers; TaskPath = $t.TaskPath; TaskName = $t.TaskName; State = $t.State; TriggerCount = $t.TriggerCount; Action = ($disp -join ' | '); UserApproved = $userApproved }
  }

  foreach ($d in @(& $Env.StartupDirs)) {
    if (-not $d.Path -or -not (Test-Path -LiteralPath $d.Path)) { continue }
    foreach ($f in @(Get-ChildItem -LiteralPath $d.Path -File -Force -ErrorAction SilentlyContinue)) {
      if ($f.Name -ieq 'desktop.ini') { continue }
      $fields = @(); $wd = $f.DirectoryName; $desc = $f.FullName
      if ($f.Extension -ieq '.lnk') {
        try {
          $l = & $Env.ResolveLnk $f.FullName
          $fields = @($l.Target, $l.Args, $l.WorkDir)
          if ($l.WorkDir) { $wd = $l.WorkDir }
          $desc = $f.FullName + ' -> ' + $l.Target + ' ' + $l.Args
        } catch { $fields = @() }
      } else { $fields = @($f.FullName) }
      $c = Get-Classification $fields $wd ''
      if ($c.Class -eq 'UNRELATED') { continue }
      $out += @{ Kind = 'Startup'; Class = $c.Class; Why = $c.Why; Wrappers = $c.Wrappers; Scope = $d.Scope; Path = $f.FullName; Action = $desc }
    }
  }

  foreach ($k in @(& $Env.RunKeys)) {
    foreach ($v in @(& $Env.ListRunValues $k)) {
      $c = Get-Classification @($v.Data) '' ''
      if ($c.Class -eq 'UNRELATED') { continue }
      $out += @{ Kind = 'Run'; Class = $c.Class; Why = $c.Why; Wrappers = $c.Wrappers; Key = $k; Name = $v.Name; Data = $v.Data; ValueKind = $v.Kind; Action = $v.Data }
    }
  }
  return $out
}

function Find-RunningApp($Env) {
  $res = @()
  foreach ($p in @(& $Env.ListNodeProcs)) {
    if ($p.CommandLine -match '(?i)next' -and $p.CommandLine -match '(?i)\bdev\b') {
      $ev = Get-Evidence @($p.CommandLine) '' '' @{} 0
      if ($ev.Roots.Count -gt 0 -and -not $ev.Other) { $res += $p }
    }
  }
  return $res
}

# ------------------------------------------------------------------ journal / backup primitives
function Test-BackupWritable([string]$bd) {
  try {
    if (-not (Test-Path -LiteralPath $bd)) { New-Item -ItemType Directory -Path $bd -Force -ErrorAction Stop | Out-Null }
    $probe = Join-Path $bd '.write-probe'
    Set-Content -LiteralPath $probe -Value 'ok' -Encoding ASCII -ErrorAction Stop
    $back = (Get-Content -LiteralPath $probe -ErrorAction Stop | Select-Object -First 1)
    Remove-Item -LiteralPath $probe -Force -ErrorAction Stop
    return ($back -eq 'ok')
  } catch { return $false }
}

# Appends one record and reads it back. Throws when the record could not be saved (caller must then NOT change anything).
function Add-Journal([string]$bd, [hashtable]$rec) {
  $jp = Join-Path $bd 'journal.jsonl'
  $rec['Time'] = (Get-Date).ToString('o')
  $line = ($rec | ConvertTo-Json -Compress -Depth 6)
  Add-Content -LiteralPath $jp -Value $line -Encoding UTF8 -ErrorAction Stop
  $last = (Get-Content -LiteralPath $jp -Tail 1 -Encoding UTF8 -ErrorAction Stop)
  if ($last -ne $line) { throw 'journal read-back mismatch' }
}

function New-UniquePath([string]$dir, [string]$name) {
  $p = Join-Path $dir $name
  $i = 1
  while (Test-Path -LiteralPath $p) { $p = Join-Path $dir ($i.ToString() + '_' + $name); $i++ }
  return $p
}

function Get-JournalState([string]$bd) {
  $jp = Join-Path $bd 'journal.jsonl'
  $state = [ordered]@{}
  if (-not (Test-Path -LiteralPath $jp)) { return @() }
  foreach ($line in (Get-Content -LiteralPath $jp -Encoding UTF8)) {
    if (-not $line.Trim()) { continue }
    try { $r = $line | ConvertFrom-Json -ErrorAction Stop } catch { throw 'Journal is damaged. No automatic restore is allowed.' }
    if (-not $r.Id) { continue }
    if ($state.Contains($r.Id)) {
      $merged = $state[$r.Id]
      foreach ($pr in $r.PSObject.Properties) { $merged | Add-Member -NotePropertyName $pr.Name -NotePropertyValue $pr.Value -Force }
      $state[$r.Id] = $merged
    } else { $state[$r.Id] = $r }
  }
  return @($state.Values)
}

# ------------------------------------------------------------------ apply
function Invoke-ApplyRegs($Env, $regs, $running, [string]$bd, [bool]$stopRunning) {
  $log = New-Object System.Collections.ArrayList
  $res = @{ Changed = 0; NotChanged = 0; Failed = 0; Log = $log; Aborted = $false }

  if (-not (Test-BackupWritable $bd)) {
    [void]$log.Add('ABORT  backup folder is not writable: ' + $bd + ' - NOTHING was changed.')
    $res.Aborted = $true
    return $res
  }
  try { Add-Journal $bd @{ Id = 'header'; Kind = 'Header'; Status = 'info' } }
  catch {
    [void]$log.Add('ABORT  journal could not be written (' + $_.Exception.Message + ') - NOTHING was changed.')
    $res.Aborted = $true
    return $res
  }

  foreach ($r in $regs) {
    if ($r.Class -ne 'CONFIRMED') { [void]$log.Add('SKIP   [' + $r.Class + '] ' + $r.Kind + ' ' + $r.Action); $res.NotChanged++; continue }
    $id = [guid]::NewGuid().ToString('N')

    if ($r.Kind -eq 'Task') {
      $label = $r.TaskPath + $r.TaskName
      if ($r.State -eq 'Disabled') { [void]$log.Add('SKIP   already disabled: ' + $label); $res.NotChanged++; continue }
      if ($r.TriggerCount -eq 0) { [void]$log.Add('SKIP   no triggers (manual only): ' + $label); $res.NotChanged++; continue }
      $pending = $false
      try {
        $xml = & $Env.ExportTaskXml $r.TaskPath $r.TaskName
        if (-not $xml -or $xml -notmatch '<Task') { throw 'task XML export returned nothing usable' }
        $xmlFile = Join-Path $bd ('task_' + $id + '.xml')
        Set-Content -LiteralPath $xmlFile -Value $xml -Encoding UTF8 -ErrorAction Stop
        if (-not (Test-Path -LiteralPath $xmlFile) -or (Get-Item -LiteralPath $xmlFile).Length -lt 20) { throw 'task XML backup verification failed' }
        Add-Journal $bd @{ Id = $id; Kind = 'Task'; Status = 'pending'; TaskPath = $r.TaskPath; TaskName = $r.TaskName; WasState = $r.State; XmlFile = $xmlFile; Action = $r.Action }
        $pending = $true
        & $Env.DisableTask $r.TaskPath $r.TaskName
        $after = & $Env.GetTaskState $r.TaskPath $r.TaskName
        if ($after -ne 'Disabled') { throw ('state after disable is ' + $after) }
        Add-Journal $bd @{ Id = $id; Status = 'done' }
        [void]$log.Add('DONE   task disabled: ' + $label); $res.Changed++
      } catch {
        if ($pending) {
          try { Add-Journal $bd @{ Id = $id; Status = 'failed'; Error = $_.Exception.Message } } catch {}
          [void]$log.Add('FAILED task (may be partly changed - check it): ' + $label + ' : ' + $_.Exception.Message); $res.Failed++
        } else {
          [void]$log.Add('NOT CHANGED task (backup/record failed): ' + $label + ' : ' + $_.Exception.Message); $res.NotChanged++
        }
      }
    }
    elseif ($r.Kind -eq 'Startup') {
      $pending = $false
      try {
        $sha = (Get-FileHash -LiteralPath $r.Path -Algorithm SHA256 -ErrorAction Stop).Hash
        $destDir = Join-Path $bd ('startup_' + $r.Scope)
        New-Item -ItemType Directory -Path $destDir -Force -ErrorAction Stop | Out-Null
        $dest = New-UniquePath $destDir (Split-Path -Leaf $r.Path)
        Copy-Item -LiteralPath $r.Path -Destination $dest -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256 -ErrorAction Stop).Hash -ne $sha) { throw 'backup copy hash mismatch' }
        Add-Journal $bd @{ Id = $id; Kind = 'Startup'; Status = 'pending'; OriginalPath = $r.Path; BackupPath = $dest; Sha256 = $sha; Scope = $r.Scope }
        $pending = $true
        Remove-Item -LiteralPath $r.Path -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $r.Path) { throw 'original still exists after removal' }
        Add-Journal $bd @{ Id = $id; Status = 'done' }
        [void]$log.Add('DONE   startup item moved to backup: ' + $r.Path); $res.Changed++
      } catch {
        if ($pending) {
          try { Add-Journal $bd @{ Id = $id; Status = 'failed'; Error = $_.Exception.Message } } catch {}
          [void]$log.Add('FAILED startup item: ' + $r.Path + ' : ' + $_.Exception.Message); $res.Failed++
        } else {
          [void]$log.Add('NOT CHANGED startup item (backup/record failed): ' + $r.Path + ' : ' + $_.Exception.Message); $res.NotChanged++
        }
      }
    }
    elseif ($r.Kind -eq 'Run') {
      $pending = $false
      try {
        $cur = & $Env.GetRunValue $r.Key $r.Name
        if (-not $cur) { throw 'value no longer exists' }
        if ($cur.Data -ne $r.Data -or $cur.Kind -ne $r.ValueKind) { throw 'value changed since discovery; refusing to remove it' }
        $bk = Join-Path $bd ('run_' + $id + '.json')
        Set-Content -LiteralPath $bk -Value (@{ Key = $r.Key; Name = $r.Name; Data = $cur.Data; Kind = $cur.Kind } | ConvertTo-Json -Compress) -Encoding UTF8 -ErrorAction Stop
        if (-not (Test-Path -LiteralPath $bk) -or (Get-Item -LiteralPath $bk).Length -lt 10) { throw 'run value backup verification failed' }
        Add-Journal $bd @{ Id = $id; Kind = 'Run'; Status = 'pending'; Key = $r.Key; Name = $r.Name; Data = $cur.Data; ValueKind = $cur.Kind }
        $pending = $true
        & $Env.RemoveRunValue $r.Key $r.Name
        if (& $Env.GetRunValue $r.Key $r.Name) { throw 'value still present after removal' }
        Add-Journal $bd @{ Id = $id; Status = 'done' }
        [void]$log.Add('DONE   Run value removed: ' + $r.Key + ' ' + $r.Name); $res.Changed++
      } catch {
        if ($pending) {
          try { Add-Journal $bd @{ Id = $id; Status = 'failed'; Error = $_.Exception.Message } } catch {}
          [void]$log.Add('FAILED Run value: ' + $r.Key + ' ' + $r.Name + ' : ' + $_.Exception.Message); $res.Failed++
        } else {
          [void]$log.Add('NOT CHANGED Run value (backup/record failed): ' + $r.Key + ' ' + $r.Name + ' : ' + $_.Exception.Message); $res.NotChanged++
        }
      }
    }
  }

  if ($stopRunning) {
    foreach ($p in $running) {
      try { & $Env.StopProc $p.Pid; [void]$log.Add('STOPPED node.exe PID ' + $p.Pid) } catch { [void]$log.Add('FAILED stop PID ' + $p.Pid + ' : ' + $_.Exception.Message); $res.Failed++ }
    }
  } elseif (@($running).Count -gt 0) { [void]$log.Add('NOTE   the app is still running now; disabling registrations does not stop it.') }
  return $res
}

# Never says "will not start". Lists what is unresolved or not scanned.
function Get-ApplySummary($res, $regs) {
  $lines = New-Object System.Collections.ArrayList
  if ($res.Aborted) {
    [void]$lines.Add('RESULT: aborted before any change. Auto-start settings are exactly as before.')
  } else {
    [void]$lines.Add('RESULT: changed=' + $res.Changed + '  not-changed=' + $res.NotChanged + '  failed=' + $res.Failed)
  }
  $left = @($regs | Where-Object { $_.Class -ne 'CONFIRMED' })
  if ($res.Failed -gt 0 -or $res.Aborted) { [void]$lines.Add('WARNING: some items were not changed or failed. It is NOT guaranteed that POKEMON RADAR will stay stopped at the next login.') }
  if ($left.Count -gt 0) {
    [void]$lines.Add('WARNING: ' + $left.Count + ' related registration(s) were left unchanged (POSSIBLE/SHARED). They may still start something:')
    foreach ($l in $left) { [void]$lines.Add('   [' + $l.Class + '] ' + $l.Kind + ' ' + $l.Action) }
  }
  [void]$lines.Add('NOT SCANNED by this tool: Windows services, Winlogon/Userinit, WMI subscriptions, group-policy logon scripts, other user accounts, tasks hidden by missing permissions, the Chrome extension auto-crawl, and any launcher outside Task Scheduler / Startup folders / Run-RunOnce.')
  [void]$lines.Add('This tool cannot prove the next login is quiet. Confirm at your next normal Windows login (this tool does not sign out or restart).')
  return @($lines)
}

# ------------------------------------------------------------------ restore
function Invoke-RestoreFrom($Env, [string]$bd) {
  $log = New-Object System.Collections.ArrayList
  $res = @{ Ok = $true; Restored = 0; Conflicts = @(); Log = $log }
  # A failure AFTER mutation still needs recovery. Reconcile pending/done/failed with real state.
  $items = @(Get-JournalState $bd | Where-Object { $_.Kind -in @('Task', 'Startup', 'Run') -and $_.Status -in @('pending', 'done', 'failed') })
  if ($items.Count -eq 0) { [void]$log.Add('Nothing to restore in ' + $bd); return $res }

  # Preflight: any conflict stops everything before a single change is made.
  $plan = @()
  foreach ($it in $items) {
    if ($it.Kind -eq 'Task') {
      $st = & $Env.GetTaskState $it.TaskPath $it.TaskName
      if (-not $st) { $res.Conflicts += ('Task not found: ' + $it.TaskPath + $it.TaskName) }
      elseif ($st -eq 'Disabled') {
        if (-not $it.XmlFile -or -not (Test-Path -LiteralPath $it.XmlFile)) { $res.Conflicts += ('Task backup is missing: ' + $it.TaskPath + $it.TaskName) }
        else {
          $current = @(& $Env.ListTasks | Where-Object { $_.TaskPath -eq $it.TaskPath -and $_.TaskName -eq $it.TaskName })
          $actions = @()
          if ($current.Count -eq 1) { foreach ($a in $current[0].Actions) { $actions += (($a.Execute + ' ' + $a.Arguments).Trim() + ' [cwd ' + $a.WorkingDirectory + ']') } }
          if ($current.Count -ne 1 -or ($actions -join ' | ') -ne $it.Action) { $res.Conflicts += ('Task action changed; will not enable it: ' + $it.TaskPath + $it.TaskName) }
          else { $plan += $it }
        }
      }
      else { [void]$log.Add('SKIP   task is not disabled now (already enabled?): ' + $it.TaskPath + $it.TaskName) }
    }
    elseif ($it.Kind -eq 'Startup') {
      if (Test-Path -LiteralPath $it.OriginalPath) {
        if ((Get-FileHash -LiteralPath $it.OriginalPath -Algorithm SHA256 -ErrorAction Stop).Hash -eq $it.Sha256) { [void]$log.Add('SKIP   startup item already has original bytes: ' + $it.OriginalPath) }
        else { $res.Conflicts += ('Startup item path already exists, will not overwrite: ' + $it.OriginalPath) }
      }
      elseif (-not (Test-Path -LiteralPath $it.BackupPath)) { $res.Conflicts += ('Backup file is missing: ' + $it.BackupPath) }
      elseif ((Get-FileHash -LiteralPath $it.BackupPath -Algorithm SHA256 -ErrorAction Stop).Hash -ne $it.Sha256) { $res.Conflicts += ('Backup file hash mismatch: ' + $it.BackupPath) }
      else { $plan += $it }
    }
    elseif ($it.Kind -eq 'Run') {
      $cur = & $Env.GetRunValue $it.Key $it.Name
      if ($cur) {
        if ($cur.Data -eq $it.Data -and $cur.Kind -eq $it.ValueKind) { [void]$log.Add('SKIP   Run value already restored: ' + $it.Key + ' ' + $it.Name) }
        else { $res.Conflicts += ('Run value exists with different content, will not overwrite: ' + $it.Key + ' ' + $it.Name) }
      } else { $plan += $it }
    }
  }
  if ($res.Conflicts.Count -gt 0) {
    $res.Ok = $false
    [void]$log.Add('STOPPED: conflicts found. NOTHING was restored. Resolve these first:')
    foreach ($c in $res.Conflicts) { [void]$log.Add('   ' + $c) }
    return $res
  }

  foreach ($it in $plan) {
    try {
      if ($it.Kind -eq 'Task') { & $Env.EnableTask $it.TaskPath $it.TaskName; [void]$log.Add('RESTORED task enabled: ' + $it.TaskPath + $it.TaskName) }
      elseif ($it.Kind -eq 'Startup') {
        $parent = Split-Path -Parent $it.OriginalPath
        if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        Copy-Item -LiteralPath $it.BackupPath -Destination $it.OriginalPath -ErrorAction Stop
        if ((Get-FileHash -LiteralPath $it.OriginalPath -Algorithm SHA256).Hash -ne $it.Sha256) { throw 'restored file hash mismatch' }
        [void]$log.Add('RESTORED startup item: ' + $it.OriginalPath + '  (backup copy kept)')
      }
      elseif ($it.Kind -eq 'Run') { & $Env.SetRunValue $it.Key $it.Name $it.Data $it.ValueKind; [void]$log.Add('RESTORED Run value: ' + $it.Key + ' ' + $it.Name) }
      $res.Restored++
      try { Add-Journal $bd @{ Id = $it.Id; Status = 'restored' } } catch { [void]$log.Add('NOTE   restored but journal could not be updated: ' + $_.Exception.Message) }
    } catch { $res.Ok = $false; [void]$log.Add('FAILED restore: ' + $it.Kind + ' : ' + $_.Exception.Message) }
  }
  return $res
}

# ------------------------------------------------------------------ main
function Resolve-ProjectRootGuess {
  if ($ProjectRoot -and (Test-Path -LiteralPath $ProjectRoot)) { return $ProjectRoot }
  $pat = Join-Path $env:USERPROFILE 'Desktop\*\*\39\pokemon-radar-v0.7.0-case-organization-stage1\pokemon-radar'
  $hit = Get-ChildItem -Path $pat -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return ''
}

function Show-Findings($regs, $running) {
  Write-Host ''; Write-Host '=== Related registrations ===' -ForegroundColor Cyan
  if (@($regs).Count -eq 0) { Write-Host '(none found in Task Scheduler / Startup folders / Run-RunOnce)' }
  foreach ($r in $regs) {
    $what = ''
    if ($r.Class -eq 'CONFIRMED') {
      if ($r.Kind -eq 'Task' -and $r.State -eq 'Disabled') { $what = 'already disabled - left as is' }
      elseif ($r.Kind -eq 'Task' -and $r.TriggerCount -eq 0) { $what = 'no triggers - left as is' }
      elseif ($r.Kind -eq 'Task') { $what = 'Apply will DISABLE it (not delete)' }
      elseif ($r.Kind -eq 'Startup') { $what = 'Apply will copy it to the backup (hash-verified) and remove it from Startup' }
      else { $what = 'Apply will back up and remove ONLY this value' }
    } elseif ($r.Class -eq 'SHARED') { $what = 'shared launcher - NOT changed' }
    else { $what = 'not proven to be POKEMON RADAR - NOT changed (read it; for a task you may approve it with -AlsoTask)' }
    $id = ''
    if ($r.Kind -eq 'Task') { $id = $r.TaskPath + $r.TaskName + '  state=' + $r.State + ' triggers=' + $r.TriggerCount }
    elseif ($r.Kind -eq 'Startup') { $id = $r.Scope + ': ' + $r.Path }
    else { $id = $r.Key + '  ' + $r.Name }
    Write-Host ('[' + $r.Class + '] ' + $r.Kind + '  ' + $id) -ForegroundColor White
    Write-Host ('    action : ' + $r.Action)
    Write-Host ('    reason : ' + $r.Why)
    if (@($r.Wrappers).Count -gt 0) { Write-Host ('    wrapper: ' + (@($r.Wrappers) -join '; ')) }
    Write-Host ('    ->     : ' + $what)
  }
  Write-Host ''; Write-Host '=== Running app processes (node.exe next dev inside a POKEMON RADAR folder) ===' -ForegroundColor Cyan
  if (@($running).Count -eq 0) { Write-Host '(none)' } else { foreach ($p in $running) { Write-Host ('PID ' + $p.Pid + ': ' + $p.CommandLine) }; Write-Host 'Disabling registrations does not stop these. Use -StopRunning with Apply or close the window yourself.' -ForegroundColor Yellow }
  Write-Host ''; Write-Host '=== Chrome extension (not changed by this tool) ===' -ForegroundColor Cyan
  Write-Host 'Daily Amazon auto-crawl runs inside the extension. To switch it OFF: chrome://extensions -> POKEMON RADAR -> service worker -> Console:'
  Write-Host '    handleAutoWatchSet({ enabled: false }).then(console.log)'
}

function New-MobileShortcut {
  $name = 'POKEMON RADAR ' + [string][char]0x30E2 + [string][char]0x30D0 + [string][char]0x30A4 + [string][char]0x30EB + '.url'
  $path = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
  [IO.File]::WriteAllText($path, ("[InternetShortcut]`r`nURL=" + $script:MobileUrl + "`r`n"), (New-Object Text.UTF8Encoding($false)))
  Write-Host ('Created: ' + $path + '  ->  ' + $script:MobileUrl)
}

function Invoke-Main {
  Write-Host ('POKEMON RADAR autostart tool v3  mode=' + $Mode)
  if ($Mode -eq 'MobileShortcut') { New-MobileShortcut; return 0 }
  $Env = New-RealAdapter
  if ($Mode -eq 'Restore') {
    $bd = $BackupDir
    if (-not $bd) {
      $latest = Get-ChildItem -LiteralPath $script:BackupBase -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName 'journal.jsonl') } | Sort-Object Name | Select-Object -Last 1
      if ($latest) { $bd = $latest.FullName }
    }
    if (-not $bd) { Write-Host 'No journal found. Nothing to restore.' -ForegroundColor Yellow; return 0 }
    $r = Invoke-RestoreFrom $Env $bd
    $r.Log | ForEach-Object { Write-Host $_ }
    if ($r.Ok) { return 0 } else { return 2 }
  }
  $regs = @(Find-Registrations $Env $AlsoTask)
  $running = @(Find-RunningApp $Env)
  Show-Findings $regs $running
  if ($Mode -eq 'Check') {
    Write-Host ''; Write-Host 'CHECK MODE: nothing was changed.' -ForegroundColor Green
    return 0
  }
  $ans = Read-Host 'Apply to the CONFIRMED items only? (type YES to continue)'
  if ($ans -ne 'YES') { Write-Host 'Cancelled. Nothing changed.'; return 0 }
  $bd = Join-Path $script:BackupBase (Get-Date -Format 'yyyyMMdd-HHmmss')
  $res = Invoke-ApplyRegs $Env $regs $running $bd $StopRunning.IsPresent
  Write-Host ''; Write-Host ('=== Apply result (backup folder: ' + $bd + ') ===') -ForegroundColor Cyan
  $res.Log | ForEach-Object { Write-Host $_ }
  Write-Host ''
  Get-ApplySummary $res $regs | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
  if ($res.Aborted -or $res.Failed -gt 0) { return 2 }
  return 0
}

if (-not $NoMain) {
  $transcriptStarted = $false
  try {
    Start-Transcript -LiteralPath (Join-Path $PSScriptRoot ('autostart-' + $Mode.ToLower() + '.txt')) -Force -ErrorAction Stop | Out-Null
    $transcriptStarted = $true
    $code = Invoke-Main
  } finally { if ($transcriptStarted) { Stop-Transcript | Out-Null } }
  exit $code
}

