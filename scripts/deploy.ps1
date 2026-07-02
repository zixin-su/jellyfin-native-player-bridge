param(
  [string]$InstallDir = "$env:ProgramFiles\jellyfin-native-player-bridge",
  [string[]]$HostName = @("127.0.0.1"),
  [string[]]$ServiceHost = @(),
  [int]$Port = 45789,
  [string]$PlayerPath = "",
  [string[]]$JellyfinUrl = @("http://localhost:8096/"),
  [switch]$RegisterStartupTask
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$BundledNode = Join-Path $SourceRoot "runtime\node.exe"

if (-not (Test-Path -LiteralPath $BundledNode)) {
  throw "Bundled runtime is missing: $BundledNode. Run scripts\prepare-runtime.bat first."
}

function Find-Player {
  param([string]$ExplicitPath)

  if ($ExplicitPath -and (Test-Path -LiteralPath $ExplicitPath)) {
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $candidates = @(
    "C:\Program Files\VideoLAN\VLC\vlc.exe",
    "C:\Program Files (x86)\VideoLAN\VLC\vlc.exe",
    "C:\Program Files\mpv\mpv.exe",
    "C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
    "C:\Program Files\DAUM\PotPlayer\PotPlayerMini.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  $commands = @("vlc", "mpv", "potplayermini64", "potplayermini")
  foreach ($command in $commands) {
    $found = Get-Command $command -ErrorAction SilentlyContinue
    if ($found) {
      return $found.Source
    }
  }

  return ""
}

function New-Secret {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  [Convert]::ToBase64String($bytes).TrimEnd("=") -replace "\+", "-" -replace "/", "_"
}

function Get-JellyfinMatchPattern {
  param([string]$Url)

  try {
    $uri = [Uri]$Url
    if (-not $uri.Scheme -or -not $uri.Authority) {
      throw "Invalid URL"
    }
    $path = $uri.AbsolutePath.TrimEnd("/")
    "$($uri.Scheme)://$($uri.Authority)$path/*"
  } catch {
    "http://localhost:8096/*"
  }
}

function Normalize-StringList {
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

function ConvertTo-JsonStringArray {
  param([string[]]$Values)

  $items = @($Values | ForEach-Object { [string]$_ | ConvertTo-Json -Compress })
  "[$($items -join ',')]"
}

function Get-HostForUrl {
  param([string]$HostValue)

  $value = ([string]$HostValue).Trim()
  if ($value.Contains(":") -and -not $value.StartsWith("[") -and -not $value.EndsWith("]")) {
    return "[$value]"
  }
  return $value
}

function Get-ServiceHostsFromListenHosts {
  param([string[]]$ListenHosts)

  $mapped = foreach ($hostValue in $ListenHosts) {
    switch ($hostValue) {
      "0.0.0.0" { "127.0.0.1"; break }
      "::" { "::1"; break }
      default { $hostValue }
    }
  }
  Normalize-StringList -Value $mapped -Fallback @("127.0.0.1")
}

function Get-UserscriptUrl {
  param(
    [string]$ServiceHostValue,
    [int]$ServicePort
  )

  "http://$(Get-HostForUrl -HostValue $ServiceHostValue)`:$ServicePort/userscript/jellyfin-native-player-bridge.user.js"
}

function Copy-App {
  param([string]$From, [string]$To)

  New-Item -ItemType Directory -Force -Path $To | Out-Null
  robocopy $From $To /MIR /XD ".git" "node_modules" "logs" "data" /XF "config.json" "runtime.json" "default-config.js" | Out-Null
  $code = $LASTEXITCODE
  if ($code -ge 8) {
    throw "robocopy failed with exit code $code"
  }
}

function Write-ConfigFiles {
  param(
    [string]$Root,
    [string]$Player,
    [string]$Secret,
    [string[]]$ListenHosts,
    [string[]]$BrowserServiceHosts,
    [string[]]$JellyfinUrls
  )

  $configDir = Join-Path $Root "config"
  $extensionDir = Join-Path $Root "extension"
  New-Item -ItemType Directory -Force -Path $configDir, $extensionDir | Out-Null

  $configPath = Join-Path $configDir "config.json"
  if (Test-Path -LiteralPath $configPath) {
    $existing = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if (-not $Player -and $existing.playerPath) {
      $Player = [string]$existing.playerPath
    }
    if ($existing.browserSecret) {
      $Secret = [string]$existing.browserSecret
    }
  }

  $config = [ordered]@{
    host = $ListenHosts[0]
    hosts = @($ListenHosts)
    serviceHosts = @($BrowserServiceHosts)
    port = $Port
    browserSecret = $Secret
    playerPath = $Player
    playerArgs = @("{url}")
    stream = [ordered]@{
      maxStreamingBitrate = 140000000
      preferStaticUrl = $true
    }
    jellyfin = [ordered]@{
      servers = @($JellyfinUrls)
      chooseFirstPlayableForFolders = $true
      requestPlaybackInfo = $true
      reportPlaybackStart = $true
      reportPlaybackStopOnLaunch = $true
      playbackStopDelaySeconds = 5
      apiTimeoutMs = 12000
    }
    logging = [ordered]@{
      directory = "logs"
      level = "info"
      retentionDays = 14
      cleanupIntervalHours = 12
    }
  }

  $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding UTF8

  $serviceHostsJson = ConvertTo-JsonStringArray -Values $BrowserServiceHosts
  $jellyfinMatches = (@($JellyfinUrls | ForEach-Object { Get-JellyfinMatchPattern -Url $_ }) | Select-Object -Unique) -join "`n// @match        "
  $serviceConnects = (@($BrowserServiceHosts + @("127.0.0.1", "localhost") | ForEach-Object {
    $connectHost = ([string]$_).Trim().TrimStart("[").TrimEnd("]")
    if ($connectHost) { $connectHost }
  }) | Select-Object -Unique) -join "`n// @connect      "
  $userscriptUrl = Get-UserscriptUrl -ServiceHostValue $BrowserServiceHosts[0] -ServicePort $Port

  $extensionConfig = @"
globalThis.JEP_DEFAULT_CONFIG = Object.freeze({
  serviceHost: "$($BrowserServiceHosts[0])",
  serviceHosts: $serviceHostsJson,
  servicePort: $Port,
  serviceToken: "$Secret",
  notifyOnSuccess: false
});
"@
  Set-Content -LiteralPath (Join-Path $extensionDir "default-config.js") -Value $extensionConfig -Encoding UTF8

  $userscriptPath = Join-Path $Root "userscript\jellyfin-native-player-bridge.user.js"
  if (Test-Path -LiteralPath $userscriptPath) {
    $userscript = Get-Content -LiteralPath $userscriptPath -Raw
    $userscript = $userscript.Replace('"__JNPB_SERVICE_HOSTS__"', $serviceHostsJson)
    $userscript = $userscript.Replace("__JNPB_SERVICE_HOST__", $BrowserServiceHosts[0])
    $userscript = $userscript.Replace("__JNPB_SERVICE_PORT__", [string]$Port)
    $userscript = $userscript.Replace("__JNPB_SERVICE_TOKEN__", $Secret)
    $userscript = $userscript.Replace("__JNPB_JELLYFIN_MATCH__", $jellyfinMatches)
    $userscript = $userscript.Replace("__JNPB_SERVICE_CONNECTS__", $serviceConnects)
    $userscript = $userscript.Replace("__JNPB_USERSCRIPT_URL__", $userscriptUrl)
    Set-Content -LiteralPath $userscriptPath -Value $userscript -Encoding UTF8
  }
}

$resolvedPlayer = Find-Player -ExplicitPath $PlayerPath
$secret = New-Secret
$listenHosts = Normalize-StringList -Value $HostName -Fallback @("127.0.0.1")
$browserServiceHosts = Normalize-StringList -Value $ServiceHost -Fallback (Get-ServiceHostsFromListenHosts -ListenHosts $listenHosts)
$jellyfinUrls = Normalize-StringList -Value $JellyfinUrl -Fallback @("http://localhost:8096/")

Copy-App -From $SourceRoot -To $InstallDir
Write-ConfigFiles -Root $InstallDir -Player $resolvedPlayer -Secret $secret -ListenHosts $listenHosts -BrowserServiceHosts $browserServiceHosts -JellyfinUrls $jellyfinUrls

if ($RegisterStartupTask) {
  & (Join-Path $InstallDir "scripts\register-startup-task.ps1")
}

Write-Host "Installed to: $InstallDir"
if ($resolvedPlayer) {
  Write-Host "Player path: $resolvedPlayer"
} else {
  Write-Host "Player path is not configured. Edit $InstallDir\config\config.json before playback."
}
Write-Host "Extension path: $InstallDir\extension"
Write-Host "Userscript path: $InstallDir\userscript\jellyfin-native-player-bridge.user.js"
Write-Host "Listener hosts: $($listenHosts -join ', ')"
Write-Host "Browser service hosts: $($browserServiceHosts -join ', ')"
Write-Host "Jellyfin URLs: $($jellyfinUrls -join ', ')"
Write-Host "Userscript URLs:"
foreach ($serviceHostValue in $browserServiceHosts) {
  Write-Host "  $(Get-UserscriptUrl -ServiceHostValue $serviceHostValue -ServicePort $Port)"
}
Write-Host "Startup task: $(if ($RegisterStartupTask) { 'registered' } else { 'not registered' })"
