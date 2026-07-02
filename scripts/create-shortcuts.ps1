$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptRoot "..")
$Launcher = Join-Path $ScriptRoot "open-edge-with-extension.bat"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "Jellyfin Native Player Bridge.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $Launcher
$shortcut.WorkingDirectory = $AppRoot
$shortcut.IconLocation = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe,0"
$shortcut.Description = "Open Jellyfin in Edge with Jellyfin Native Player Bridge loaded."
$shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"
