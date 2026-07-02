. "$PSScriptRoot\common.ps1"

New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

$running = Test-JepService
if ($running) {
  $hosts = if ($running.hosts) { ($running.hosts -join ", ") } else { $running.host }
  Write-Host "Jellyfin Native Player Bridge is already running on hosts $hosts, port $($running.port), PID $($running.pid)."
  exit 0
}

if (-not (Test-Path $NodeExe)) {
  throw "Node.js executable was not found. Install Node.js or deploy runtime\node.exe."
}

$serviceEntry = Join-Path $AppRoot "service\src\index.js"
$arguments = @(
  "`"$serviceEntry`"",
  "--config",
  "`"$ConfigPath`""
) -join " "

Start-Process -FilePath $NodeExe -ArgumentList $arguments -WorkingDirectory $AppRoot -WindowStyle Hidden | Out-Null
Start-Sleep -Milliseconds 900

$started = Test-JepService
if ($started) {
  $hosts = if ($started.hosts) { ($started.hosts -join ", ") } else { $started.host }
  Write-Host "Started Jellyfin Native Player Bridge on hosts $hosts, port $($started.port), PID $($started.pid)."
  exit 0
}

Write-Host "Start command was issued, but the health check did not respond yet. Check logs under $AppRoot\logs."
exit 1
