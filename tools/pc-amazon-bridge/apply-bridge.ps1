$ErrorActionPreference = 'Stop'
try {
  $bridgeSource = $PSScriptRoot

  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = 'Select the POKEMON RADAR chrome-extension folder'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host 'Cancelled. No files were changed.'
    exit 1
  }
  $bridgeTarget = $dialog.SelectedPath

  $manifestPath = Join-Path $bridgeTarget 'manifest.json'
  $popupPath = Join-Path $bridgeTarget 'popup.html'
  $popupJsPath = Join-Path $bridgeTarget 'popup.js'

  if (!(Test-Path -LiteralPath $manifestPath)) { throw 'manifest.json was not found. No files were changed.' }
  if (!(Test-Path -LiteralPath $popupPath)) { throw 'popup.html was not found. No files were changed.' }
  if (!(Test-Path -LiteralPath $popupJsPath)) { throw 'popup.js was not found. No files were changed.' }

  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne '1.19.25') {
    throw 'Extension version is not 1.19.25. No files were changed.'
  }

  $currentHash = (Get-FileHash -LiteralPath $popupPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $newHash = (Get-FileHash -LiteralPath (Join-Path $bridgeSource 'popup.html') -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($currentHash -ne '7e97871a27324b22fe99d6c0ab69177d20f92b2042eafcf99f1ec78b76ef51f7' -and $currentHash -ne $newHash) {
    throw 'popup.html differs from the verified version. No files were changed.'
  }

  $parent = Split-Path -Parent $bridgeTarget
  $backupRoot = Join-Path $parent 'pokemon-radar-amazon-backups'
  New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
  $backup = Join-Path $backupRoot ('amazon-bridge-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $backup | Out-Null

  $bridgeFiles = @(
    'popup.html',
    'amazonBridgePopup.js',
    'amazonBridgeCapture.js',
    'amazonSearchCapture.js'
  )

  foreach ($name in $bridgeFiles) {
    $old = Join-Path $bridgeTarget $name
    if (Test-Path -LiteralPath $old) {
      Copy-Item -LiteralPath $old -Destination (Join-Path $backup $name)
    }
  }

  try {
    foreach ($name in $bridgeFiles) {
      $source = Join-Path $bridgeSource $name
      if (!(Test-Path -LiteralPath $source)) { throw ('Missing installer file: ' + $name) }
      Copy-Item -LiteralPath $source -Destination (Join-Path $bridgeTarget $name) -Force
    }
  } catch {
    foreach ($name in $bridgeFiles) {
      $saved = Join-Path $backup $name
      $target = Join-Path $bridgeTarget $name
      if (Test-Path -LiteralPath $saved) {
        Copy-Item -LiteralPath $saved -Destination $target -Force
      } else {
        Remove-Item -LiteralPath $target -ErrorAction SilentlyContinue
      }
    }
    throw
  }

  Write-Host 'Amazon bridge installed successfully.'
  Write-Host ('Extension folder: ' + $bridgeTarget)
  Write-Host ('Backup folder: ' + $backup)
  Write-Host 'Open chrome://extensions and reload POKEMON RADAR Import.'
} catch {
  Write-Host ('ERROR: ' + $_.Exception.Message)
  exit 1
}
