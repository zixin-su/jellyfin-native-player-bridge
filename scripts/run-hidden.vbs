Option Explicit

Dim shell, fso, scriptDir, appRoot, nodeExe, configPath, serviceEntry, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
appRoot = fso.GetParentFolderName(scriptDir)
nodeExe = appRoot & "\runtime\node.exe"
If Not fso.FileExists(nodeExe) Then
  WScript.Quit 2
End If

configPath = appRoot & "\config\config.json"
serviceEntry = appRoot & "\service\src\index.js"
command = """" & nodeExe & """ """ & serviceEntry & """ --config """ & configPath & """"

shell.CurrentDirectory = appRoot
shell.Run command, 0, False
