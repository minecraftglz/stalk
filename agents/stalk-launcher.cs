// Stalk Windows Agent - silent launcher (NO window at all).
//
// Double-click this exe: it starts windows-agent.ps1 with a fully hidden
// PowerShell process (CreateNoWindow + Hidden window style) and exits.
//
// Build:  csc /target:winexe /out:stalk-launcher.exe stalk-launcher.cs
//
// /target:winexe  -> Windows subsystem, no console window is ever created.
// CreateNoWindow  -> the spawned PowerShell gets no console window either.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

static class StalkLauncher
{
    [STAThread]
    static void Main()
    {
        string dir;
        try { dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location); }
        catch { dir = null; }
        if (string.IsNullOrEmpty(dir)) dir = AppDomain.CurrentDomain.BaseDirectory;

        string ps1 = Path.Combine(dir, "windows-agent.ps1");
        if (!File.Exists(ps1)) return;

        string psi = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            @"WindowsPowerShell\v1.0\powershell.exe");
        if (!File.Exists(psi)) psi = "powershell.exe";

        ProcessStartInfo pi = new ProcessStartInfo();
        pi.FileName = psi;
        pi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + ps1 + "\"";
        pi.UseShellExecute = false;
        pi.CreateNoWindow = true;
        pi.WindowStyle = ProcessWindowStyle.Hidden;
        pi.WorkingDirectory = dir;

        try { Process.Start(pi); } catch { }
    }
}
