# Fluetix — stop the background server started by launch.ps1
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0.

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$pidFile = Join-Path $appDir 'run\fluetix.pid'

if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $existingPid -Force
        Write-Host "Fluetix stopped."
    } else {
        Write-Host "Fluetix isn't running."
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
} else {
    Write-Host "Fluetix isn't running."
}
Start-Sleep -Seconds 2
