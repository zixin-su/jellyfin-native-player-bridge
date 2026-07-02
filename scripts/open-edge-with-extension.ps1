param(
  [string]$Url = "http://localhost:8096/"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$ExtensionPath = Join-Path $AppRoot "extension"
$ProfilePath = Join-Path $AppRoot "data\edge-profile"

$edgeCandidates = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
)

$edge = $edgeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) {
  $edgeCommand = Get-Command msedge.exe -ErrorAction SilentlyContinue
  if ($edgeCommand) {
    $edge = $edgeCommand.Source
  }
}
if (-not $edge) {
  throw "Microsoft Edge executable was not found."
}

New-Item -ItemType Directory -Force -Path $ProfilePath | Out-Null

$args = @(
  "--user-data-dir=$ProfilePath",
  "--profile-directory=Default",
  "--disable-extensions-except=$ExtensionPath",
  "--load-extension=$ExtensionPath",
  "--no-first-run",
  $Url
)

Start-Process -FilePath $edge -ArgumentList $args -WorkingDirectory $AppRoot
