$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$ConfigPath = Join-Path $AppRoot "config\config.json"
$DataDir = Join-Path $AppRoot "data"
$PidFile = Join-Path $DataDir "service.pid"
$StateFile = Join-Path $DataDir "runtime-state.json"
$NodeExe = Join-Path $AppRoot "runtime\node.exe"
if (-not (Test-Path $NodeExe)) {
  throw "Bundled Node.js runtime was not found: $NodeExe. Run scripts\prepare-runtime.bat from the project before deploying."
}

function Read-JepConfig {
  if (-not (Test-Path $ConfigPath)) {
    throw "Missing config file: $ConfigPath"
  }
  Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
}

function Get-JepStringList {
  param(
    [object]$Value,
    [string[]]$Fallback = @()
  )

  $result = New-Object System.Collections.Generic.List[string]
  foreach ($raw in @($Value)) {
    if ($null -eq $raw) {
      continue
    }
    foreach ($part in ([string]$raw -split '[;,]')) {
      $trimmed = $part.Trim()
      if ($trimmed -and -not $result.Contains($trimmed)) {
        $result.Add($trimmed)
      }
    }
  }
  if ($result.Count -gt 0) {
    return [string[]]$result.ToArray()
  }
  return [string[]]$Fallback
}

function Get-JepUrlHost {
  param([string]$HostName)

  $value = ([string]$HostName).Trim()
  if ($value.Contains(":") -and -not $value.StartsWith("[") -and -not $value.EndsWith("]")) {
    return "[$value]"
  }
  return $value
}

function Get-JepBaseUrl {
  $config = Read-JepConfig
  $hosts = Get-JepStringList -Value $config.serviceHosts -Fallback (Get-JepStringList -Value $config.hosts -Fallback @([string]$config.host, "127.0.0.1"))
  $hostName = if ($hosts.Count -gt 0) { $hosts[0] } else { "127.0.0.1" }
  $port = if ($config.port) { [int]$config.port } else { 45789 }
  "http://$(Get-JepUrlHost -HostName $hostName)`:$port"
}

function Get-JepHeaders {
  $config = Read-JepConfig
  $headers = @{}
  if ($config.browserSecret) {
    $headers["X-JEP-Token"] = [string]$config.browserSecret
  }
  $headers
}

function Invoke-JepService {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [string]$Method = "GET",
    [object]$Body = $null,
    [int]$TimeoutSec = 8
  )

  $uri = "$(Get-JepBaseUrl)$Path"
  $headers = Get-JepHeaders
  $params = @{
    Uri = $uri
    Method = $Method
    Headers = $headers
    TimeoutSec = $TimeoutSec
  }
  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }
  Invoke-RestMethod @params
}

function Test-JepService {
  try {
    $result = Invoke-JepService -Path "/health" -Method "GET" -TimeoutSec 3
    return $result
  } catch {
    return $null
  }
}

function Get-JepPid {
  if (Test-Path $PidFile) {
    $value = (Get-Content -LiteralPath $PidFile -Raw).Trim()
    if ($value -match '^\d+$') {
      return [int]$value
    }
  }
  return $null
}

function Stop-JepProcessByPid {
  $pidValue = Get-JepPid
  if (-not $pidValue) {
    return $false
  }
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $process) {
    return $false
  }
  Stop-Process -Id $pidValue -Force
  return $true
}

function Get-JepTaskName {
  "JellyfinNativePlayerBridge"
}
