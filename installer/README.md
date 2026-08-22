# Fluetix Windows installer

Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
Licensed under the Apache License, Version 2.0 — see [../LICENSE](../LICENSE) and [../NOTICE](../NOTICE).

Builds a single `Fluetix-2026-Setup.exe` for end users. No `git clone`, no manual `npm`/`pip`
commands — the installer downloads everything it needs itself.

## What it does

1. Shows the author/co-author notice ([ABOUT.txt](ABOUT.txt)) and the Apache 2.0 license.
2. Copies the app (pre-built front end + backend source) to `Program Files\Fluetix`.
3. Runs [scripts/install-prereqs.ps1](scripts/install-prereqs.ps1), which:
   - Installs Python 3.10+ via `winget` if not already present.
   - Installs the GTK3 runtime via `winget` if not already present (needed by WeasyPrint for
     PDF report generation).
   - Creates a private virtual environment inside the install folder and installs every backend
     Python package into it — nothing touches the system/global Python.
4. Adds Start Menu and (optional) Desktop shortcuts that run
   [scripts/launch.bat](scripts/launch.bat) — this starts the backend (which also serves the
   built front end, see `backend/app/main.py`'s static-file mount) and opens it in the default
   browser at `http://127.0.0.1:8000/`.
5. Registers a normal Windows uninstaller (Add/Remove Programs) that stops any running Fluetix
   process, removes the app and its private virtual environment, and removes the shortcuts.
   Python and the GTK3 runtime are left in place, since other software may depend on them too.

No account, purchase, subscription, or payment is involved anywhere in this process — every
component installed (Python, GTK3, the Python packages themselves) is free and open source.
Requires an internet connection during install for step 3.

**Known limitation:** the installer is not code-signed (that requires a paid certificate), so
Windows SmartScreen will likely show an "Unknown Publisher" warning the first time
`Fluetix-2026-Setup.exe` is run. This is expected — click "More info" → "Run anyway".

## Building it yourself

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php) (free) — `winget install JRSoftware.InnoSetup`.

```bash
# from the repo root
npm install
npm run build          # produces dist/ — the installer packages this, not source files
"C:\Users\<you>\AppData\Local\Programs\Inno Setup 6\ISCC.exe" installer\Fluetix.iss
```

Output: `installer/output/Fluetix-2026-Setup.exe` (gitignored — attach it to a GitHub Release
rather than committing it, since it's a large binary that changes on every rebuild).

## Layout

```
installer/
├── Fluetix.iss              Inno Setup script — the installer definition itself
├── ABOUT.txt                 Credits/notices page shown before the license page
├── scripts/
│   ├── install-prereqs.ps1   Run once after install: Python/GTK3 via winget, venv, pip install
│   ├── launch.ps1 / .bat     Start Menu / Desktop shortcut target — starts the app, opens browser
│   ├── stop.ps1 / .bat       Stops the background server started by launch.ps1
│   └── uninstall-cleanup.ps1 Run by the uninstaller before files are removed
└── output/                   Compiled Fluetix-2026-Setup.exe lands here (gitignored)
```
