$ErrorActionPreference = "Stop"

$policyPath = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"
$nameHint = "JellyfinNativePlayerBridge"
if (-not (Test-Path -Path $policyPath)) {
  Write-Host "Edge extension policy path does not exist."
  exit 0
}

$properties = Get-ItemProperty -Path $policyPath
foreach ($property in $properties.PSObject.Properties) {
  if ($property.Name -match '^\d+$' -and ([string]$property.Value) -match 'edge-extension/updates\.xml') {
    Remove-ItemProperty -Path $policyPath -Name $property.Name -ErrorAction SilentlyContinue
    Write-Host "Removed Edge extension policy entry: $($property.Name)"
  }
}
