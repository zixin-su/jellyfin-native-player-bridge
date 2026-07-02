. "$PSScriptRoot\common.ps1"

$taskName = Get-JepTaskName
& schtasks.exe /Query /TN $taskName | Out-Null
if ($LASTEXITCODE -eq 0) {
  & schtasks.exe /Delete /TN $taskName /F | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to unregister startup scheduled task: $taskName"
  }
  Write-Host "Unregistered startup scheduled task: $taskName"
} else {
  Write-Host "Startup scheduled task does not exist: $taskName"
}
