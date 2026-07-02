. "$PSScriptRoot\common.ps1"

Invoke-JepService -Path "/cleanup-logs" -Method "POST" -Body @{} -TimeoutSec 8 | Out-Null
Write-Host "Log cleanup requested."
