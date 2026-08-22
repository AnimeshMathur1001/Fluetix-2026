"""Mobile remote-control pairing: LAN discovery, the standalone phone
controller page, and the gesture relay socket.

- GET  /remote/interfaces  -> every local IPv4 address this machine currently
  has (Wi-Fi, Ethernet, a phone-hosted hotspot's adapter, this PC's own
  hotspot adapter, ...) so the front end can show one QR code per network
  and the phone connects over whichever one it actually shares with this PC.
- GET  /remote             -> the offline single-page controller app itself,
  served as plain static HTML/JS so a phone's browser needs nothing but the
  URL encoded in the QR code (see static/remote_controller.html).
- WS   /remote/ws          -> both the desktop app (?role=desktop) and the
  phone page (?role=phone) connect here with the same ?session= id; phone
  gesture messages are relayed verbatim to the desktop side by
  services/remote_hub.py. No gesture logic lives server-side — this is a
  dumb pipe, all interpretation happens in the browser tab on each end.
"""
from __future__ import annotations

import socket
from pathlib import Path

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse

from ..services import remote_hub

try:
    import psutil
except ImportError:  # pragma: no cover - degrades to hostname-based discovery below
    psutil = None  # type: ignore[assignment]

router = APIRouter(prefix="/remote", tags=["remote"])

_CONTROLLER_HTML = Path(__file__).resolve().parent.parent / "static" / "remote_controller.html"


def _is_private_lan_ip(ip: str) -> bool:
    """RFC 1918 (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) — every range a
    home/office router, phone hotspot, or Windows/macOS PC-hotspot adapter
    actually hands out. Excludes loopback and link-local (169.254.x.x)."""
    parts = ip.split(".")
    if len(parts) != 4 or not all(p.isdigit() for p in parts):
        return False
    a, b = int(parts[0]), int(parts[1])
    return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def _list_interfaces() -> list[dict]:
    """Every private-LAN IPv4 address currently bound to a local adapter —
    covers a home/office Wi-Fi, a phone's hotspot this PC joined, and this
    PC's own hotspot all at once, since a laptop can easily have more than
    one active at a time."""
    found: dict[str, str] = {}
    if psutil is not None:
        for name, addrs in psutil.net_if_addrs().items():
            for addr in addrs:
                if addr.family == socket.AF_INET and _is_private_lan_ip(addr.address):
                    found.setdefault(addr.address, name)
    else:
        # No psutil: falls back to whatever the hostname resolves to, which
        # usually only surfaces the primary adapter, not every hotspot too.
        try:
            for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
                if _is_private_lan_ip(ip):
                    found.setdefault(ip, "network")
        except OSError:
            pass
    return [{"ip": ip, "label": label} for ip, label in sorted(found.items())]


@router.get("/interfaces")
def list_interfaces(request: Request) -> JSONResponse:
    host_header = request.headers.get("host", "")
    port = int(host_header.split(":")[1]) if ":" in host_header else request.url.port or 8000
    return JSONResponse({"interfaces": _list_interfaces(), "port": port})


@router.get("/")
def controller_page() -> FileResponse:
    return FileResponse(_CONTROLLER_HTML, media_type="text/html")


@router.websocket("/ws")
async def remote_ws(ws: WebSocket) -> None:
    session_id = ws.query_params.get("session")
    role = ws.query_params.get("role")
    if role not in ("desktop", "phone"):
        await ws.close(code=1008)
        return

    await ws.accept()
    await remote_hub.join(session_id, role, ws)
    try:
        if role == "phone":
            await ws.send_json({"type": "connected"})
        while True:
            message = await ws.receive_json()
            if role == "phone":
                await remote_hub.relay_from_phone(session_id, message)
    except WebSocketDisconnect:
        pass
    finally:
        await remote_hub.leave(session_id, role, ws)
