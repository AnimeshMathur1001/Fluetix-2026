"""Fluetix desktop window.

Opens a native OS window (via pywebview, using the system's built-in
WebView2 runtime on Windows) pointed at the already-running local backend,
used instead of opening a system browser tab. The app's own Save/Load
buttons and command palette (src/components/Header.tsx,
src/components/CommandPalette.tsx) already use native file
pickers/downloads under the hood, so there's no separate native menu here.
Launched by launch.ps1 once the backend is confirmed healthy.

Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
"""

import ctypes
import os
import subprocess
from pathlib import Path

import webview

# Without this, Windows groups/icons this window's taskbar button by the
# shared pythonw.exe interpreter it happens to run under (showing Python's
# own icon there) instead of treating it as its own distinct app -- the
# window's own title-bar icon is unaffected either way, since that comes
# straight from Form.Icon further down.
if os.name == "nt":
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
        "AnimeshMathur.Fluetix.DesktopApp"
    )

# The page's own Save button downloads a .hxproj.json via a Blob (see
# src/lib/projectFile.ts) -- pywebview cancels all downloads unless this is
# set, which then shows its own native Save-As dialog on the download.
webview.settings["ALLOW_DOWNLOADS"] = True

APP_URL = "http://127.0.0.1:8000/"
RUN_DIR = Path(os.environ["LOCALAPPDATA"]) / "Fluetix" / "run"
PID_FILE = RUN_DIR / "fluetix.pid"

# Without this, the taskbar/Alt-Tab icon for this window falls back to
# pythonw.exe's own generic Python icon, since it's the process actually
# running it -- it needs to be pointed at Fluetix's own icon explicitly.
ICON_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "fluetix.ico"


def on_closed() -> None:
    # Closing the app window stops the backend server process launch.ps1
    # started too, rather than leaving it running invisibly.
    try:
        pid = PID_FILE.read_text().strip()
        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, check=False)
    except OSError:
        pass


window = webview.create_window(
    "Fluetix",
    APP_URL,
    width=1400,
    height=900,
    min_size=(900, 600),
)
window.events.closed += on_closed

if __name__ == "__main__":
    webview.start(icon=str(ICON_PATH) if ICON_PATH.exists() else None)
