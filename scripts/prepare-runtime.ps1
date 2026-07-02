param(
  [string]$NodeExe = ""
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$RuntimeDir = Join-Path $AppRoot "runtime"
$TargetNode = Join-Path $RuntimeDir "node.exe"

if (-not $NodeExe) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw "Node.js was not found for bootstrapping. Pass -NodeExe C:\path\to\node.exe once, then this project no longer depends on system Node."
  }
  $NodeExe = $nodeCommand.Source
}

if (-not (Test-Path -LiteralPath $NodeExe)) {
  throw "Node executable does not exist: $NodeExe"
}

$NodeExe = (Resolve-Path -LiteralPath $NodeExe).Path
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
Copy-Item -LiteralPath $NodeExe -Destination $TargetNode -Force

$sourceDir = Split-Path -Parent $NodeExe
foreach ($name in @("LICENSE", "README.md", "CHANGELOG.md")) {
  $sourceFile = Join-Path $sourceDir $name
  if (Test-Path -LiteralPath $sourceFile) {
    Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $RuntimeDir "NODE-$name") -Force
  }
}

$version = & $TargetNode --version
Set-Content -LiteralPath (Join-Path $RuntimeDir "README.txt") -Value @"
This directory contains the project-local Node.js runtime used by Jellyfin Native Player Bridge.

Runtime version: $version
Source executable copied from: $NodeExe

The service scripts intentionally use runtime\node.exe and do not depend on a system PATH Node.js installation.
"@ -Encoding UTF8

Write-Host "Bundled Node.js runtime: $TargetNode ($version)"
