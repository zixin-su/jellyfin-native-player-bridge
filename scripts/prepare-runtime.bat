@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-runtime.ps1" %*
