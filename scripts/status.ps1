. "$PSScriptRoot\common.ps1"

$running = Test-JepService
if ($running) {
  $hosts = if ($running.hosts) { ($running.hosts -join ", ") } else { $running.host }
  Write-Host "Running: PID $($running.pid), hosts $hosts, port $($running.port), version $($running.version)"
  exit 0
}

Write-Host "Not running."
exit 1
