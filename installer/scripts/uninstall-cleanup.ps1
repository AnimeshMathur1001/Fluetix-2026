# Fluetix — pre-removal cleanup, run by the uninstaller before files are deleted
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0.
#
# Stops any running Fluetix server so the uninstaller isn't blocked by
# locked files, then removes the virtual environment (not installed via
# the installer's own file list, so it must be cleaned up explicitly here)
# and the per-user run directory under %LOCALAPPDATA%. Python and the GTK3
# runtime (shared system components, not private to Fluetix) are
# deliberately left in place.

param(
    [Parameter(Mandatory = $true)][string]$AppDir
)

$runDir = Join-Path $env:LOCALAPPDATA 'Fluetix\run'
$pidFile = Join-Path $runDir 'fluetix.pid'
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid) {
        Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 1

Remove-Item -Recurse -Force -Path (Join-Path $AppDir 'venv') -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force -Path $runDir -ErrorAction SilentlyContinue
