$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$state = Join-Path $env:LOCALAPPDATA 'PokemonRadarCollector'
New-Item -ItemType Directory -Force -Path $state | Out-Null
$log = Join-Path $state 'daily-launcher.log'
try {
    Set-Location -LiteralPath $root
    $git = (Get-Command git.exe -ErrorAction Stop).Source
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $origin = & $git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $origin -notmatch '^(https://github\.com/|git@github\.com:)yasuyasu55/pokemon-radar-mobile(\.git)?$') { throw 'Unexpected repository' }
    $branch = & $git branch --show-current
    if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Expected main branch' }
    $dirty = & $git status --porcelain --untracked-files=no
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Local changes exist; update stopped' }
    & $git pull --ff-only origin main *> $log
    if ($LASTEXITCODE -ne 0) { throw 'Update failed; see daily-launcher.log' }
    $out = Join-Path $state 'daily-output.log'
    $err = Join-Path $state 'daily-error.log'
    $proc = Start-Process -FilePath $node -ArgumentList 'tools/pc-collector/run.mjs' -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
    Add-Content -LiteralPath $log -Value ('Finished {0:o}; exit={1}; result=last-result.json' -f (Get-Date),$proc.ExitCode)
    exit $proc.ExitCode
} catch {
    Add-Content -LiteralPath $log -Value ('ERROR {0:o}: {1}' -f (Get-Date),$_.Exception.Message)
    exit 1
}
