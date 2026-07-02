$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$ConfigPath = Join-Path $AppRoot "config\config.json"
$Runner = Join-Path $ScriptRoot "run-hidden.vbs"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "This script must run as Administrator."
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

function Write-EdgePolicy {
  Write-Host "Skipping Edge machine policy. Use install-one-click.bat to create the Edge launcher shortcut."
}

function Register-StartupTask {
  $taskName = "JellyfinNativePlayerBridge"
  $runnerForTask = Get-ShortPath -Path $Runner
  $taskRun = "wscript.exe $runnerForTask"

  & schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskRun /F | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to register startup scheduled task: $taskName"
  }
  Write-Host "Registered startup scheduled task: $taskName"
}

Assert-Admin
Write-EdgePolicy
Register-StartupTask

& gpupdate.exe /target:computer /force | Out-Host
Write-Host "System integration installed."
