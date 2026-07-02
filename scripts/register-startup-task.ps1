. "$PSScriptRoot\common.ps1"

$taskName = Get-JepTaskName
$runner = Join-Path $ScriptRoot "run-hidden.vbs"

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

$runnerForTask = Get-ShortPath -Path $runner
$taskRun = "wscript.exe $runnerForTask"

& schtasks.exe /Create /TN $taskName /SC ONLOGON /TR $taskRun /F | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register startup scheduled task: $taskName"
}

Write-Host "Registered startup scheduled task: $taskName"
