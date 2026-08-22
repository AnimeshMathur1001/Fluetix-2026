"""Fluetix desktop window.

Opens a native OS window (via pywebview, using the system's built-in
WebView2 runtime on Windows) pointed at the already-running local backend,
with a real File menu — used instead of opening a system browser tab.
Launched by launch.ps1 once the backend is confirmed healthy.

Author: Animesh Mathur. Co-Authors: Arihant Kumar Singh, Aviral Gupta.
Licensed under the Apache License, Version 2.0. See LICENSE and NOTICE.
"""

import json
import os
import subprocess
from pathlib import Path

import webview
from webview.menu import Menu, MenuAction, MenuSeparator

# The Save action downloads a .hxproj.json via the page's own Blob-download
# code (src/lib/projectFile.ts, unchanged from the browser build) — pywebview
# cancels all downloads unless this is set, which shows its own native
# Save-As dialog on the download, so no separate native dialog wiring is
# needed here for Save.
webview.settings["ALLOW_DOWNLOADS"] = True

APP_URL = "http://127.0.0.1:8000/"
RUN_DIR = Path(os.environ["LOCALAPPDATA"]) / "Fluetix" / "run"
PID_FILE = RUN_DIR / "fluetix.pid"

window: webview.Window


def _bridge_call(js_expression: str) -> None:
    window.evaluate_js(f"window.__fluetixDesktop && window.__fluetixDesktop.{js_expression}")


def menu_new() -> None:
    _bridge_call("newCase()")


def menu_open() -> None:
    paths = window.create_file_dialog(
        webview.FileDialog.OPEN,
        file_types=("Fluetix project (*.json)", "All files (*.*)"),
    )
    if not paths:
        return
    text = Path(paths[0]).read_text(encoding="utf-8")
    _bridge_call(f"open({json.dumps(text)})")


def menu_save() -> None:
    _bridge_call("save()")


def menu_exit() -> None:
    window.destroy()


def on_closed() -> None:
    # Closing the app window stops the backend server process launch.ps1
    # started too, rather than leaving it running invisibly.
    try:
        pid = PID_FILE.read_text().strip()
        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True, check=False)
    except OSError:
        pass


file_menu = Menu(
    "File",
    [
        MenuAction("New", menu_new),
        MenuAction("Open...", menu_open),
        MenuAction("Save", menu_save),
        MenuSeparator(),
        MenuAction("Exit", menu_exit),
    ],
)

window = webview.create_window(
    "Fluetix",
    APP_URL,
    width=1400,
    height=900,
    min_size=(900, 600),
    menu=[file_menu],
)
window.events.closed += on_closed

if __name__ == "__main__":
    webview.start()
