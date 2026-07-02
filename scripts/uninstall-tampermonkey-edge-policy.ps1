param(
  [string]$ExtensionId = "iikmkjmpaadaobahmlepeloendndfphd"
)

$ErrorActionPreference = "Stop"

$policyPath = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"
if (-not (Test-Path -Path $policyPath)) {
  Write-Host "Tampermonkey Edge policy was not found."
  exit 0
}

$existing = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Tampermonkey Edge policy was not found."
  exit 0
}

$removed = 0
foreach ($property in $existing.PSObject.Properties) {
  if ($property.Name -match '^\d+$' -and [string]$property.Value -like "$ExtensionId;*") {
    Remove-ItemProperty -Path $policyPath -Name $property.Name -ErrorAction SilentlyContinue
    $removed++
  }
}

Write-Host "Removed Tampermonkey Edge policy entries: $removed"
Write-Host "Restart Edge for the policy change to take effect."
