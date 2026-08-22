# Fluetix — prerequisite + Python-environment setup
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Run once by the installer after files are copied. Ensures Python 3.10+
# and the GTK3 runtime (needed by WeasyPrint for PDF reports) are present,
# installing either via winget if missing, then creates a private virtual
# environment inside the install directory and installs every backend
# package into it — nothing is written to the system/global Python.

param(
    [Parameter(Mandatory = $true)][string]$AppDir
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-CommandExists([string]$Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}

Write-Host "Fluetix setup - installing required components" -ForegroundColor Green
Write-Host "Author: Animesh Mathur   Co-Authors: Arihant Kumar Singh, Aviral Gupta"

if (-not (Test-CommandExists 'winget')) {
    throw "Windows Package Manager (winget) was not found. It ships with Windows 10/11 by default. Please update Windows App Installer from the Microsoft Store, then re-run this installer."
}

# --- 1. Python 3.10+ -------------------------------------------------------
$pythonExe = $null
if (Test-CommandExists 'python') {
    try {
        $verOut = (& python --version) 2>&1
        if ($verOut -match '(\d+)\.(\d+)') {
            $maj = [int]$Matches[1]; $min = [int]$Matches[2]
            if ($maj -gt 3 -or ($maj -eq 3 -and $min -ge 10)) {
                $pythonExe = (Get-Command python).Source
            }
        }
    } catch {}
}

if (-not $pythonExe) {
    Write-Step "Python 3.10+ not found - installing Python 3.12 via winget (requires internet)"
    winget install --id Python.Python.3.12 -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Python installation via winget failed (exit code $LASTEXITCODE). Install Python 3.10+ manually from python.org and re-run this installer."
    }
    Refresh-Path
    if (Test-CommandExists 'python') { $pythonExe = (Get-Command python).Source }
    if (-not $pythonExe) {
        throw "Python was installed but is not yet on PATH in this session. Please re-run this installer (or restart Windows) to finish setup."
    }
} else {
    Write-Step "Python already present: $pythonExe"
}

# --- 2. GTK3 runtime (required by WeasyPrint for PDF report generation) ----
$gtkPresent = $null -ne (winget list --id tschoonj.GTKForWindows 2>&1 | Select-String 'tschoonj.GTKForWindows')
if (-not $gtkPresent) {
    Write-Step "GTK3 runtime not found - installing via winget (needed for PDF report generation)"
    winget install --id tschoonj.GTKForWindows -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: GTK3 runtime installation failed. Every Fluetix feature except PDF report generation will still work." -ForegroundColor Yellow
    }
} else {
    Write-Step "GTK3 runtime already present"
}

# --- 3. Private virtual environment + Python packages -----------------------
Write-Step "Creating a private Python environment for Fluetix"
$venvDir = Join-Path $AppDir 'venv'
if (Test-Path $venvDir) { Remove-Item -Recurse -Force $venvDir }
& $pythonExe -m venv $venvDir
if ($LASTEXITCODE -ne 0) { throw "Failed to create the Python virtual environment." }

$venvPython = Join-Path $venvDir 'Scripts\python.exe'

Write-Step "Installing Fluetix's Python packages (this can take several minutes)"
& $venvPython -m pip install --upgrade pip --no-input
& $venvPython -m pip install --no-input -r (Join-Path $AppDir 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install one or more required Python packages. Check your internet connection and re-run this installer."
}

Write-Step "Setup complete - Fluetix is ready to launch"
