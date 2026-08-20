<#
.SYNOPSIS
Dev launcher for hotshare-win (Windows).

1. Kills any stale Electron app instance (single-instance app, so a running
   one would just focus the existing window instead of restarting).
2. Launches the app as the current user with dev env vars:
   - HOTSHARE_SKIP_ENTITLEMENT=1  (bypasses licensing check)
   - ELECTRON_DISABLE_GPU=1        (avoids GPU crashes on VMs)
   - Runs with --no-sandbox        (required when running Electron as non-admin;
     on Windows the helper triggers UAC for hotspot start/stop, which is separate).

The app is launched through node + electron/cli.js (NOT electron.exe directly).
electron.exe is a GUI-subsystem binary, so its stdout never attaches to the
console and the script appears to "do nothing". node cli.js keeps the console
stream alive so the portal/dashboard URLs are printed, and Ctrl-C stops it.
#>

# Resolve paths relative to this script's location
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = [System.IO.Path]::GetFullPath("$scriptDir/..")
$appDir   = [System.IO.Path]::GetFullPath("$repoRoot/apps/hotshare-win")
$node     = 'C:\Program Files\nodejs\node.exe'
$electron = [System.IO.Path]::GetFullPath("$repoRoot/node_modules/electron/cli.js")

if (-not (Test-Path $node)) {
    Write-Error "ERROR: node.exe not found at $node"
    exit 1
}
if (-not (Test-Path $electron)) {
    Write-Error "ERROR: electron cli.js not found at $electron"
    Write-Error "Fix: cd $repoRoot && node node_modules/electron/install.js"
    exit 1
}

# Kill any stale Electron processes (the app is single-instance)
Write-Output "==> Killing stale app instances"
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Set environment and launch
$env:HOTSHARE_SKIP_ENTITLEMENT = '1'
$env:ELECTRON_DISABLE_GPU = '1'
$env:NODE_ENV = 'development'

Set-Location $appDir
Write-Output "==> Launching hotshare (ctrl-c to stop)"
Write-Output "   Electron: $electron"
Write-Output "   App dir:  $appDir"
& $node $electron . --no-sandbox