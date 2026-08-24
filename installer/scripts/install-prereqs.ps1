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

# Finds a real Python 3.10+ on PATH, skipping Windows Store app-execution-alias
# stubs (e.g. %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe) -- these are
# 0-byte reparse points that can run `python --version` fine but silently
# no-op on anything heavier (like `-m venv`) when invoked from this elevated
# installer, since UWP alias activation doesn't run at admin integrity level.
function Get-RealPythonExe {
    foreach ($candidate in (Get-Command python -All -ErrorAction SilentlyContinue)) {
        $path = $candidate.Source
        if (-not $path) { continue }
        $item = Get-Item $path -ErrorAction SilentlyContinue
        if (-not $item -or $item.Length -eq 0) { continue }
        try {
            $verOut = (& $path --version) 2>&1
            if ($verOut -match '(\d+)\.(\d+)') {
                $maj = [int]$Matches[1]; $min = [int]$Matches[2]
                if ($maj -gt 3 -or ($maj -eq 3 -and $min -ge 10)) {
                    return $path
                }
            }
        } catch {}
    }
    return $null
}

Write-Host "Fluetix setup - installing required components" -ForegroundColor Green
Write-Host "Author: Animesh Mathur   Co-Authors: Arihant Kumar Singh, Aviral Gupta"

if (-not (Test-CommandExists 'winget')) {
    throw "Windows Package Manager (winget) was not found. It ships with Windows 10/11 by default. Please update Windows App Installer from the Microsoft Store, then re-run this installer."
}

# --- 1. Python 3.10+ -------------------------------------------------------
$pythonExe = Get-RealPythonExe

if (-not $pythonExe) {
    Write-Step "Python 3.10+ not found - installing Python 3.12 via winget (requires internet)"
    winget install --id Python.Python.3.12 -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Python installation via winget failed (exit code $LASTEXITCODE). Install Python 3.10+ manually from python.org and re-run this installer."
    }
    Refresh-Path
    $pythonExe = Get-RealPythonExe
    if (-not $pythonExe) {
        throw "Python was installed but is not yet on PATH in this session. Please re-run this installer (or restart Windows) to finish setup."
    }
} else {
    Write-Step "Python already present: $pythonExe"
}

# --- 2. Microsoft Edge WebView2 Runtime (required for the native desktop --
# window — backend/app/webview_window.py has no fallback if this is
# missing, unlike the GTK3/PDF case below). Present out of the box on
# most current Windows 10/11 installs, but not guaranteed on older
# builds, LTSC editions, or machines with Windows Update locked down.
function Test-WebView2Present {
    $clientId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    $regPaths = @(
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
        "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$clientId"
    )
    foreach ($path in $regPaths) {
        $key = Get-ItemProperty -Path $path -Name 'pv' -ErrorAction SilentlyContinue
        if ($key -and $key.pv -and $key.pv -ne '0.0.0.0') { return $true }
    }
    return $false
}

if (Test-WebView2Present) {
    Write-Step "Microsoft Edge WebView2 Runtime already present"
} else {
    Write-Step "Microsoft Edge WebView2 Runtime not found - installing via winget (required for Fluetix's app window to open)"
    winget install --id Microsoft.EdgeWebView2Runtime -e --silent --disable-interactivity --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: WebView2 Runtime installation via winget failed (exit code $LASTEXITCODE). Fluetix's app window will not open without it - install it manually from https://developer.microsoft.com/microsoft-edge/webview2/ and re-run this installer." -ForegroundColor Yellow
    }
}

# --- 3. GTK3 runtime (required by WeasyPrint for PDF report generation) ----
# Downloaded and run directly with its own NSIS silent switch (/S) rather
# than through "winget install" -- winget's --silent flag only suppresses
# winget's own prompts, not this specific package's installer UI, which
# left users stuck looking at (and having to click through) a hidden
# installer window with no visible progress from winget's side.
function Test-GtkPresent {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'GTK3-Runtime Win64\bin\libgobject-2.0-0.dll'),
        (Join-Path ${env:ProgramFiles(x86)} 'GTK3-Runtime Win64\bin\libgobject-2.0-0.dll')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $true }
    }
    $pathDirs = $env:Path -split ';'
    foreach ($dir in $pathDirs) {
        if ($dir -and (Test-Path (Join-Path $dir 'libgobject-2.0-0.dll'))) { return $true }
    }
    return $false
}

if (Test-GtkPresent) {
    Write-Step "GTK3 runtime already present"
} else {
    Write-Step "GTK3 runtime not found - downloading (needed for PDF report generation)"
    $gtkInstallerPath = Join-Path $env:TEMP 'fluetix-gtk3-runtime-setup.exe'
    $gtkOk = $true
    try {
        $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/tschoonj/GTK-for-Windows-Runtime-Environment-Installer/releases/latest' -UseBasicParsing
        $asset = $release.assets | Where-Object { $_.name -like '*win64*.exe' } | Select-Object -First 1
        if (-not $asset) { throw "Could not find a win64 installer asset in the latest GTK3 runtime release." }
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $gtkInstallerPath -UseBasicParsing
    } catch {
        Write-Host ("Warning: could not download the GTK3 runtime (" + $_.Exception.Message + "). PDF report generation will not work, every other Fluetix feature will.") -ForegroundColor Yellow
        $gtkOk = $false
    }

    if ($gtkOk) {
        Write-Step "Installing GTK3 runtime silently"
        try {
            $gtkProc = Start-Process -FilePath $gtkInstallerPath -ArgumentList '/S' -PassThru
            $finished = $gtkProc.WaitForExit(180000)
            if (-not $finished) {
                Stop-Process -Id $gtkProc.Id -Force -ErrorAction SilentlyContinue
                Write-Host "Warning: GTK3 runtime installer did not finish within 3 minutes and was stopped. PDF report generation may not work." -ForegroundColor Yellow
            }
        } catch {
            Write-Host ("Warning: GTK3 runtime installation failed (" + $_.Exception.Message + "). Every other Fluetix feature will still work.") -ForegroundColor Yellow
        }
        Remove-Item -Force $gtkInstallerPath -ErrorAction SilentlyContinue
    }
}

# --- 4. Private virtual environment + Python packages -----------------------
Write-Step "Creating a private Python environment for Fluetix"
$venvDir = Join-Path $AppDir 'venv'
if (Test-Path $venvDir) { Remove-Item -Recurse -Force $venvDir }
& $pythonExe -m venv $venvDir
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $venvPython)) {
    throw "Failed to create the Python virtual environment (using $pythonExe)."
}

Write-Step "Installing Fluetix's Python packages (this can take several minutes)"
& $venvPython -m pip install --upgrade pip --no-input
& $venvPython -m pip install --no-input -r (Join-Path $AppDir 'backend\requirements.txt') -r (Join-Path $AppDir 'backend\requirements-desktop.txt')
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install one or more required Python packages. Check your internet connection and re-run this installer."
}

Write-Step "Setup complete - Fluetix is ready to launch"
