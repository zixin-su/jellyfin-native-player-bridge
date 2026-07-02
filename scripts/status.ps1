. "$PSScriptRoot\common.ps1"

$running = Test-JepService
if ($running) {
  Write-Host "Running: PID $($running.pid), $($running.host):$($running.port), version $($running.version)"
  exit 0
}

Write-Host "Not running."
exit 1
