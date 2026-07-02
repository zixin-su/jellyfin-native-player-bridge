. "$PSScriptRoot\common.ps1"

$result = Invoke-JepService -Path "/reload" -Method "POST" -Body @{} -TimeoutSec 8
if ($result.restartRequired) {
  Write-Host "Configuration reloaded. Listener host or port changed, restart the service for that change to take effect."
} else {
  Write-Host "Configuration reloaded."
}
