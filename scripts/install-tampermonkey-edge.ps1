param(
  [string]$ExtensionId = "iikmkjmpaadaobahmlepeloendndfphd",
  [string]$UpdateUrl = "https://edge.microsoft.com/extensionwebstorebase/v1/crx"
)

$ErrorActionPreference = "Stop"

$policyPath = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"
$value = "$ExtensionId;$UpdateUrl"

New-Item -Path $policyPath -Force | Out-Null
$existing = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue

$propertyName = $null
if ($existing) {
  foreach ($property in $existing.PSObject.Properties) {
    if ($property.Name -match '^\d+$' -and [string]$property.Value -eq $value) {
      $propertyName = $property.Name
      break
    }
  }
}

if (-not $propertyName) {
  $used = @()
  if ($existing) {
    $used = $existing.PSObject.Properties |
      Where-Object { $_.Name -match '^\d+$' } |
      ForEach-Object { [int]$_.Name }
  }
  $next = 1
  while ($used -contains $next) {
    $next++
  }
  $propertyName = [string]$next
}

New-ItemProperty -Path $policyPath -Name $propertyName -PropertyType String -Value $value -Force | Out-Null

Write-Host "Tampermonkey Edge policy installed."
Write-Host "Policy path: $policyPath"
Write-Host "Policy value: $propertyName = $value"
Write-Host "Restart Edge or wait for policy refresh, then open edge://extensions to confirm Tampermonkey is installed."
Write-Host "Userscript URL: http://127.0.0.1:45789/userscript/jellyfin-native-player-bridge.user.js"
