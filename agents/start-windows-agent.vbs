' ============================================================
' Stalk Windows Agent - silent launcher (no window, background)
'
' Double-click this file to start the agent with NO console window.
' Put a shortcut to this file in shell:startup for auto-start on boot.
'
' Prefer stalk-launcher.exe (native no-window launcher);
' fall back to running windows-agent.ps1 fully hidden.
' ============================================================
Option Explicit
Dim fso, shell, base, exePath, ps1Path, psExe, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = base & "\stalk-launcher.exe"
ps1Path = base & "\windows-agent.ps1"

If fso.FileExists(exePath) Then
  ' 0 = hidden window, False = do not wait for the process to exit
  shell.Run """" & exePath & """", 0, False
ElseIf fso.FileExists(ps1Path) Then
  psExe = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
  cmd = """" & psExe & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1Path & """"
  shell.Run cmd, 0, False
Else
  MsgBox "stalk-launcher.exe / windows-agent.ps1 not found.", 16, "Stalk Agent"
End If

