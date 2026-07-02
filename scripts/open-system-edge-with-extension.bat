@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-system-edge-with-extension.ps1" -CloseRunningEdge %*
