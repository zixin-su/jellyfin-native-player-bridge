. "$PSScriptRoot\common.ps1"

$running = Test-JepService
if ($running) {
  try {
    Invoke-JepService -Path "/shutdown" -Method "POST" -Body @{} -TimeoutSec 5 | Out-Null
    Start-Sleep -Milliseconds 800
    if (-not (Test-JepService)) {
      Write-Host "Stopped Jellyfin Native Player Bridge."
      exit 0
    }
  } catch {
    Write-Host "Graceful shutdown failed: $($_.Exception.Message)"
  }
}

if (Stop-JepProcessByPid) {
  Write-Host "Stopped Jellyfin Native Player Bridge process by PID file."
  exit 0
}

Write-Host "Jellyfin Native Player Bridge is not running."
exit 0
