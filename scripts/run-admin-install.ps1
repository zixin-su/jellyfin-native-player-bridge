$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AdminScript = Join-Path $ScriptRoot "install-system-integration-admin.ps1"

Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-File",
  "`"$AdminScript`""
) -Verb RunAs -Wait
