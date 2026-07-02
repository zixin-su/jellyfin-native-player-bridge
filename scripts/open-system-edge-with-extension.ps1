param(
  [string]$Url = "http://localhost:8096/",
  [switch]$CloseRunningEdge
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$ExtensionPath = Join-Path $AppRoot "extension"

function Find-Edge {
  $candidates = @(
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }
  $command = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }
  throw "Microsoft Edge executable was not found."
}

if (-not (Test-Path -LiteralPath $ExtensionPath)) {
  throw "Extension directory was not found: $ExtensionPath"
}

if ($CloseRunningEdge) {
  Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 2
}

$args = @(
  "--profile-directory=Default",
  "--load-extension=$ExtensionPath",
  "--no-first-run",
  $Url
)

Start-Process -FilePath (Find-Edge) -ArgumentList $args -WorkingDirectory $AppRoot
