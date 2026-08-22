# Fluetix launcher
# Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
# Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
#
# Starts the backend (which also serves the built front end, see
# backend/app/main.py) in the background if it isn't already running,
# then opens the desktop shell (backend/app/webview_window.py) — a native
# OS window with a real File menu, not a system browser tab. Runs with no
# visible console window. On failure this shows a message box instead of
# printing to a console that would just flash and disappear, and always
# writes a log to run\launch.log for troubleshooting.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Split-Path -Parent $scriptDir
$runDir = Join-Path $env:LOCALAPPDATA 'Fluetix\run'
New-Item -ItemType Directory -Force -Path $runDir | Out-Null
$logFile = Join-Path $runDir 'launch.log'

function Write-Log([string]$Message) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -Path $logFile -Value "[$stamp] $Message"
}

function Show-FailureAndExit([string]$Message) {
    Write-Log "FAILED: $Message"
    $fullText = $Message + "`n`nDetails were written to:`n" + $logFile
    [System.Windows.Forms.MessageBox]::Show($fullText, 'Fluetix could not start', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error) | Out-Null
    exit 1
}

Write-Log "launch.ps1 starting (appDir=$appDir)"

$venvPythonw = Join-Path $appDir 'venv\Scripts\pythonw.exe'
$venvPython = Join-Path $appDir 'venv\Scripts\python.exe'

$runner = $null
if (Test-Path $venvPythonw) {
    $runner = $venvPythonw
} elseif (Test-Path $venvPython) {
    $runner = $venvPython
}

if (-not $runner) {
    $venvPath = Join-Path $appDir 'venv'
    $scriptsPath = Join-Path $appDir 'scripts'
    $notReadyMsg = "Fluetix's Python environment isn't set up (no venv found under $venvPath). This usually means the setup step that installs Python packages didn't finish. Try reinstalling Fluetix, or re-run install-prereqs.ps1 from $scriptsPath as Administrator and watch for errors."
    Show-FailureAndExit $notReadyMsg
}

Write-Log "Using interpreter: $runner"

$pidFile = Join-Path $runDir 'fluetix.pid'

$alreadyRunning = $false
if (Test-Path $pidFile) {
    $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($existingPid) {
        $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        if ($existingProc) {
            $alreadyRunning = $true
            Write-Log "Backend already running (pid $existingPid)"
        }
    }
}

$backendDir = Join-Path $appDir 'backend'

if ($alreadyRunning) {
    [System.Windows.Forms.MessageBox]::Show('Fluetix is already running.', 'Fluetix', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    exit 0
}

$stdoutLog = Join-Path $runDir 'backend.out.log'
$stderrLog = Join-Path $runDir 'backend.err.log'

Write-Log "Starting backend: $runner -m app.main (cwd=$backendDir)"

$startArgs = @{}
$startArgs.FilePath = $runner
$startArgs.ArgumentList = @('-m', 'app.main')
$startArgs.WorkingDirectory = $backendDir
$startArgs.WindowStyle = 'Hidden'
$startArgs.PassThru = $true
$startArgs.RedirectStandardOutput = $stdoutLog
$startArgs.RedirectStandardError = $stderrLog

$proc = $null
try {
    $proc = Start-Process @startArgs
} catch {
    $startErrorMsg = "Could not start the Fluetix backend process: " + $_.Exception.Message
    Show-FailureAndExit $startErrorMsg
}
$proc.Id | Out-File -FilePath $pidFile -Encoding ascii
Write-Log "Backend process id: $($proc.Id)"

$ready = $false
$attempt = 0
while ($attempt -lt 40) {
    Start-Sleep -Milliseconds 500
    if ($proc.HasExited) {
        break
    }
    try {
        $healthResponse = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 1
        if ($healthResponse.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
    }
    $attempt = $attempt + 1
}

if (-not $ready) {
    $reason = "the backend did not respond on http://127.0.0.1:8000 within 20 seconds. Another program may already be using port 8000."
    if ($proc.HasExited) {
        $reason = "the backend process exited immediately (exit code $($proc.ExitCode))."
    }
    Write-Log "Startup failed: $reason"
    if (Test-Path $stderrLog) {
        $errTail = Get-Content $stderrLog -Tail 15 -ErrorAction SilentlyContinue
        if ($errTail) {
            Write-Log "Last backend error output:"
            Write-Log ($errTail -join "`n")
        }
    }
    $failMsg = "Fluetix's backend failed to start: " + $reason + "`n`nSee run\backend.err.log next to launch.log for the full error."
    Show-FailureAndExit $failMsg
}
Write-Log "Backend is up and responding on port 8000"

Write-Log "Opening desktop window"
$windowStdoutLog = Join-Path $runDir 'window.out.log'
$windowStderrLog = Join-Path $runDir 'window.err.log'
try {
    Start-Process -FilePath $runner -ArgumentList @('-m', 'app.webview_window') -WorkingDirectory $backendDir -RedirectStandardOutput $windowStdoutLog -RedirectStandardError $windowStderrLog
} catch {
    $windowErrorMsg = "The backend started, but the desktop window could not be opened: " + $_.Exception.Message
    Show-FailureAndExit $windowErrorMsg
}
