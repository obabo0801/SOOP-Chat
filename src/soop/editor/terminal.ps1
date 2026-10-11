param([Parameter(Mandatory=$true)][string]$Request)
$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Request)) | ConvertFrom-Json
Start-Process -FilePath wt.exe -ArgumentList $data.arguments -WindowStyle Minimized

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SoopTerminal {
    private delegate bool Callback(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Callback callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    public static void Minimize(int[] processes) {
        EnumWindows((window, parameter) => {
            uint process;
            GetWindowThreadProcessId(window, out process);
            if (Array.IndexOf(processes, (int)process) >= 0 && IsWindowVisible(window)) ShowWindowAsync(window, 7);
            return true;
        }, IntPtr.Zero);
    }
}
'@
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $processes = @(Get-Process WindowsTerminal -ErrorAction SilentlyContinue | Where-Object {$_.SessionId -eq (Get-Process -Id $PID).SessionId})
    if ($processes.Count) { [SoopTerminal]::Minimize([int[]]$processes.Id) }
    Start-Sleep -Milliseconds 100
}
