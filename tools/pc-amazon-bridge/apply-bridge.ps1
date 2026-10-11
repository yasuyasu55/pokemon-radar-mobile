$ErrorActionPreference = 'Stop'
try {
  $bridgeSource = $PSScriptRoot
  $bridgeCandidates = @()
  $chromeData = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'
  if (Test-Path -LiteralPath $chromeData) {
    foreach ($profile in (Get-ChildItem -LiteralPath $chromeData -Directory | Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' })) {
      foreach ($prefName in @('Preferences', 'Secure Preferences')) {
        $pref = Join-Path $profile.FullName $prefName
        if (!(Test-Path -LiteralPath $pref)) { continue }
        try {
          $settings = (Get-Content -LiteralPath $pref -Raw -Encoding UTF8 | ConvertFrom-Json).extensions.settings
          foreach ($entry in $settings.PSObject.Properties) {
            $folder = $entry.Value.path
            if (!$folder -or !(Test-Path -LiteralPath (Join-Path $folder 'manifest.json'))) { continue }
            $manifest = Get-Content -LiteralPath (Join-Path $folder 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($manifest.name -eq 'POKEMON RADAR 取込' -and $manifest.version -eq '1.19.25') { $bridgeCandidates += $folder }
          }
        } catch { }
      }
    }
  }
  $bridgeCandidates = @($bridgeCandidates | Select-Object -Unique)
  if ($bridgeCandidates.Count -eq 1) { $bridgeTarget = $bridgeCandidates[0] }
  else {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'POKEMON RADARのchrome-extensionフォルダを選んでください'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { Write-Host '変更せず終了しました。'; exit 1 }
    $bridgeTarget = $dialog.SelectedPath
  }
  $manifest = Get-Content -LiteralPath (Join-Path $bridgeTarget 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.name -ne 'POKEMON RADAR 取込' -or $manifest.version -ne '1.19.25') { throw '対応するPOKEMON RADAR取込拡張1.19.25ではありません。変更していません。' }
  $popup = Join-Path $bridgeTarget 'popup.html'
  $currentHash = (Get-FileHash -LiteralPath $popup -Algorithm SHA256).Hash.ToLowerInvariant()
  $newHash = (Get-FileHash -LiteralPath (Join-Path $bridgeSource 'popup.html') -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($currentHash -ne '7e97871a27324b22fe99d6c0ab69177d20f92b2042eafcf99f1ec78b76ef51f7' -and $currentHash -ne $newHash) { throw 'popup.htmlが確認済みの版と異なります。上書きせず終了しました。' }
  $backup = Join-Path $bridgeTarget ('_backup-amazon-bridge-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
  New-Item -ItemType Directory -Path $backup | Out-Null
  $bridgeFiles = @('popup.html', 'amazonBridgePopup.js', 'amazonBridgeCapture.js', 'amazonSearchCapture.js')
  foreach ($name in $bridgeFiles) { $old = Join-Path $bridgeTarget $name; if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath $old -Destination (Join-Path $backup $name) } }
  try {
    foreach ($name in $bridgeFiles) { Copy-Item -LiteralPath (Join-Path $bridgeSource $name) -Destination (Join-Path $bridgeTarget $name) -Force }
  } catch {
    foreach ($name in $bridgeFiles) { $old = Join-Path $backup $name; if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath $old -Destination (Join-Path $bridgeTarget $name) -Force } else { Remove-Item -LiteralPath (Join-Path $bridgeTarget $name) -ErrorAction SilentlyContinue } }
    throw
  }
  Write-Host '追加できました。Chromeの拡張機能管理画面でPOKEMON RADAR取込の再読み込みボタンを押してください。'
  Write-Host ('保存先: ' + $bridgeTarget)
  Write-Host ('元ファイルの控え: ' + $backup)
} catch { Write-Host $_.Exception.Message; exit 1 }
