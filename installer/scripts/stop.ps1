# Fluetix — stop the background server started by launch.ps1
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0.

Add-Type -AssemblyName System.Windows.Forms | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $appDir 'run\fluetix.pid'

$message = 'Fluetix was not running.'
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $existingPid -Force
        $message = 'Fluetix has been stopped.'
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
}

[System.Windows.Forms.MessageBox]::Show(
    $message, 'Fluetix',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
) | Out-Null
