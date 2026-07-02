param(
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = if ($InstallDir) { Resolve-Path -LiteralPath $InstallDir } else { Resolve-Path (Join-Path $ScriptRoot "..") }
$ExtensionDir = Join-Path $AppRoot "extension"
$DistDir = Join-Path $AppRoot "dist"
$KeyPath = Join-Path $DistDir "jellyfin-native-player-bridge.pem"
$CrxPath = Join-Path $DistDir "jellyfin-native-player-bridge.crx"
$ConfigPath = Join-Path $AppRoot "config\config.json"

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

function Get-CrxPublicKeyBytes {
  param([Parameter(Mandatory=$true)][string]$Path)

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $magic = [System.Text.Encoding]::ASCII.GetString($bytes, 0, 4)
  if ($magic -ne "Cr24") {
    throw "Invalid CRX file: $Path"
  }
  $version = [BitConverter]::ToUInt32($bytes, 4)
  if ($version -eq 2) {
    $pubLen = [BitConverter]::ToUInt32($bytes, 8)
    $sigLen = [BitConverter]::ToUInt32($bytes, 12)
    $pub = New-Object byte[] $pubLen
    [Array]::Copy($bytes, 16, $pub, 0, $pubLen)
    return $pub
  }
  if ($version -eq 3) {
    $headerLen = [BitConverter]::ToUInt32($bytes, 8)
    $header = New-Object byte[] $headerLen
    [Array]::Copy($bytes, 12, $header, 0, $headerLen)

    for ($i = 0; $i -lt $header.Length - 2; $i++) {
      if ($header[$i] -eq 18) {
        $length = $header[$i + 1]
        if ($length -gt 32 -and ($i + 2 + $length) -le $header.Length) {
          $candidate = New-Object byte[] $length
          [Array]::Copy($header, $i + 2, $candidate, 0, $length)
          return $candidate
        }
      }
    }
    throw "Unable to read CRX3 public key from $Path"
  }
  throw "Unsupported CRX version $version"
}

function Convert-PublicKeyToExtensionId {
  param([byte[]]$PublicKey)

  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash($PublicKey)
  $chars = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt 16; $i++) {
    $byte = $hash[$i]
    [void]$chars.Append([char]([int][char]'a' + (($byte -shr 4) -band 0x0f)))
    [void]$chars.Append([char]([int][char]'a' + ($byte -band 0x0f)))
  }
  $chars.ToString()
}

function Update-Config {
  param(
    [string]$ExtensionId,
    [string]$CrxFile
  )

  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Missing config file: $ConfigPath"
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if (-not $config.edgeExtension) {
    $config | Add-Member -NotePropertyName edgeExtension -NotePropertyValue ([pscustomobject]@{})
  }
  $config.edgeExtension | Add-Member -NotePropertyName id -NotePropertyValue $ExtensionId -Force
  $config.edgeExtension | Add-Member -NotePropertyName crxPath -NotePropertyValue "dist/jellyfin-native-player-bridge.crx" -Force
  $config.edgeExtension | Add-Member -NotePropertyName version -NotePropertyValue "0.1.0" -Force
  $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

function Install-Policy {
  param(
    [string]$ExtensionId,
    [string]$UpdateUrl
  )

  $policyPath = "HKCU:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"
  New-Item -Path $policyPath -Force | Out-Null

  $existing = Get-ItemProperty -Path $policyPath -ErrorAction SilentlyContinue
  $propertyName = $null
  if ($existing) {
    foreach ($property in $existing.PSObject.Properties) {
      if ($property.Name -match '^\d+$' -and ([string]$property.Value).StartsWith("$ExtensionId;")) {
        $propertyName = $property.Name
        break
      }
    }
  }

  if (-not $propertyName) {
    $used = @()
    if ($existing) {
      $used = $existing.PSObject.Properties | Where-Object { $_.Name -match '^\d+$' } | ForEach-Object { [int]$_.Name }
    }
    $next = 1
    while ($used -contains $next) {
      $next++
    }
    $propertyName = [string]$next
  }

  New-ItemProperty -Path $policyPath -Name $propertyName -PropertyType String -Value "$ExtensionId;$UpdateUrl" -Force | Out-Null
}

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

$edge = Find-Edge
$packArgs = @("--pack-extension=$ExtensionDir")
if (Test-Path -LiteralPath $KeyPath) {
  $packArgs += "--pack-extension-key=$KeyPath"
}

& $edge $packArgs | Out-Host
Start-Sleep -Milliseconds 1200

$sourceCrx = "$ExtensionDir.crx"
$sourcePem = "$ExtensionDir.pem"
if (Test-Path -LiteralPath $sourceCrx) {
  Move-Item -LiteralPath $sourceCrx -Destination $CrxPath -Force
}
if ((Test-Path -LiteralPath $sourcePem) -and -not (Test-Path -LiteralPath $KeyPath)) {
  Move-Item -LiteralPath $sourcePem -Destination $KeyPath -Force
}
if (-not (Test-Path -LiteralPath $CrxPath)) {
  throw "CRX package was not created: $CrxPath"
}

$extensionId = Convert-PublicKeyToExtensionId -PublicKey (Get-CrxPublicKeyBytes -Path $CrxPath)
Update-Config -ExtensionId $extensionId -CrxFile $CrxPath

. (Join-Path $ScriptRoot "common.ps1")
$baseUrl = Get-JepBaseUrl
$updateUrl = "$baseUrl/edge-extension/updates.xml"
Install-Policy -ExtensionId $extensionId -UpdateUrl $updateUrl

try {
  Invoke-RestMethod -Uri "$baseUrl/reload" -Method Post -Headers (Get-JepHeaders) -ContentType "application/json" -Body "{}" -TimeoutSec 5 | Out-Null
} catch {
  Write-Host "Service reload failed. Restart the listener if Edge cannot fetch the CRX update."
}

Write-Host "Packed extension: $CrxPath"
Write-Host "Extension ID: $extensionId"
Write-Host "Installed Edge policy: $extensionId;$updateUrl"
Write-Host "Restart Edge, then open edge://extensions to confirm the extension is installed."
