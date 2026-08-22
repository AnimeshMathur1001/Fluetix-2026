# Fluetix launcher
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Starts the backend (which also serves the built front end, see
# backend/app/main.py) in the background if it isn't already running,
# then opens it in the default browser.

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir

$venvPythonw = Join-Path $appDir 'venv\Scripts\pythonw.exe'
$venvPython = Join-Path $appDir 'venv\Scripts\python.exe'
$runner = if (Test-Path $venvPythonw) { $venvPythonw } elseif (Test-Path $venvPython) { $venvPython } else { $null }

if (-not $runner) {
    Write-Host "Fluetix's Python environment isn't set up yet. Please reinstall Fluetix, or re-run install-prereqs.ps1 from the install folder's scripts subfolder." -ForegroundColor Red
    Start-Sleep -Seconds 6
    exit 1
}

$runDir = Join-Path $appDir 'run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$pidFile = Join-Path $runDir 'fluetix.pid'

$alreadyRunning = $false
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
        $alreadyRunning = $true
    }
}

if (-not $alreadyRunning) {
    $backendDir = Join-Path $appDir 'backend'
    $proc = Start-Process -FilePath $runner -ArgumentList '-m', 'app.main' -WorkingDirectory $backendDir -WindowStyle Hidden -PassThru
    $proc.Id | Out-File -FilePath $pidFile -Encoding ascii

    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1
            if ($r.StatusCode -eq 200) { break }
        } catch {}
    }
}

Start-Process 'http://127.0.0.1:8000/'
