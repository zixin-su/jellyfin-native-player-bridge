param(
  [string]$InstallDir = "$env:ProgramFiles\jellyfin-native-player-bridge",
  [string]$JellyfinUrl = "http://localhost:8096/",
  [switch]$NoLaunch,
  [switch]$LaunchEdge
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
$CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$CurrentPrincipal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)

function Relaunch-AsAdmin {
  $script = Join-Path $ScriptRoot "install-one-click.ps1"
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "`"$script`"",
    "-InstallDir",
    "`"$InstallDir`"",
    "-JellyfinUrl",
    "`"$JellyfinUrl`""
  )
  if ($NoLaunch) {
    $args += "-NoLaunch"
  }
  if ($LaunchEdge) {
    $args += "-LaunchEdge"
  }
  Start-Process -FilePath "powershell.exe" -ArgumentList $args -Verb RunAs
}

function Require-Admin {
  if (-not $CurrentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Requesting administrator permission..."
    Relaunch-AsAdmin
    exit 0
  }
}

function Get-ShortPath {
  param([Parameter(Mandatory=$true)][string]$Path)

  try {
    $fso = New-Object -ComObject Scripting.FileSystemObject
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      return $fso.GetFile($Path).ShortPath
    }
    return $fso.GetFolder($Path).ShortPath
  } catch {
    return $Path
  }
}

function Remove-OldEdgePolicy {
  $ids = @(
    "bacgdfjfbkanhbjfeghgaeebmfdkgife",
    "ljhihmimklpbfnndffmolfgbfkabmfei"
  )

  $forceList = "HKLM:\Software\Policies\Microsoft\Edge\ExtensionInstallForcelist"
  if (Test-Path -Path $forceList) {
    $properties = Get-ItemProperty -Path $forceList
    foreach ($property in $properties.PSObject.Properties) {
      if ($property.Name -match '^\d+$' -and ([string]$property.Value) -match 'edge-extension/updates\.xml|jellyfin-native-player-bridge') {
        Remove-ItemProperty -Path $forceList -Name $property.Name -ErrorAction SilentlyContinue
      }
    }
  }

  foreach ($id in $ids) {
    Remove-Item -Path "HKLM:\Software\Microsoft\Edge\Extensions\$id" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Microsoft\Edge\Extensions\$id" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Microsoft\Edge\Extension\$id" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Wow6432Node\Microsoft\Edge\Extensions\$id" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Wow6432Node\Microsoft\Edge\Extension\$id" -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Register-StartupTask {
  $taskName = "JellyfinNativePlayerBridge"
  $runner = Join-Path $InstallDir "scripts\run-hidden.vbs"
  $runnerForTask = Get-ShortPath -Path $runner
  $taskRun = "wscript.exe $runnerForTask"

  & schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskRun /F | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to register startup scheduled task: $taskName"
  }
}

function New-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath("Desktop")
  $shortcutPath = Join-Path $desktop "Jellyfin Native Player Bridge.lnk"
  $launcher = Join-Path $InstallDir "scripts\open-system-edge-with-extension.bat"
  $edgeIcon = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcher
  $shortcut.WorkingDirectory = $InstallDir
  if (Test-Path -LiteralPath $edgeIcon) {
    $shortcut.IconLocation = "$edgeIcon,0"
  }
  $shortcut.Description = "Open Jellyfin in your default Edge profile with Jellyfin Native Player Bridge loaded."
  $shortcut.Save()
  Write-Host "Created desktop shortcut: $shortcutPath"
}

Require-Admin

if ((Resolve-Path -LiteralPath $SourceRoot).Path -ne $InstallDir) {
  & (Join-Path $SourceRoot "scripts\deploy.ps1") -InstallDir $InstallDir -JellyfinUrl $JellyfinUrl
}

& (Join-Path $InstallDir "scripts\stop-listener.ps1") | Out-Host
& (Join-Path $InstallDir "scripts\start-listener.ps1") | Out-Host

Register-StartupTask
Remove-OldEdgePolicy
New-DesktopShortcut

if ($LaunchEdge -and -not $NoLaunch) {
  & (Join-Path $InstallDir "scripts\open-system-edge-with-extension.ps1") -Url $JellyfinUrl -CloseRunningEdge
}

Write-Host ""
Write-Host "Installed Jellyfin Native Player Bridge."
Write-Host "Install directory: $InstallDir"
Write-Host "Jellyfin URL: $JellyfinUrl"
Write-Host "Edge launcher shortcut: Desktop\\Jellyfin Native Player Bridge.lnk"
Write-Host "Edge was not launched automatically. Use -LaunchEdge if you want the installer to open it."
