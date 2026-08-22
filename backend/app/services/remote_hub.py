"""In-memory pairing/relay registry for the mobile remote-control feature.

One "desktop" WebSocket (the CAD app itself) and one "phone" WebSocket (the
controller page served by routers/remote.py) join the same session id — the
same id already used to isolate mesh/solve case directories (see
services/job_state.py) — and gesture JSON sent by the phone is relayed
verbatim to the desktop. Nothing is persisted and nothing crosses sessions,
so two people on the same LAN pairing at once never see each other's input.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import WebSocket

from .job_state import normalize_session_id


@dataclass
class RemoteChannel:
    desktop: WebSocket | None = None
    phone: WebSocket | None = None


_channels: dict[str, RemoteChannel] = {}


def _channel(session_id: str | None) -> RemoteChannel:
    sid = normalize_session_id(session_id)
    channel = _channels.get(sid)
    if channel is None:
        channel = RemoteChannel()
        _channels[sid] = channel
    return channel


async def join(session_id: str | None, role: str, ws: WebSocket) -> RemoteChannel:
    channel = _channel(session_id)
    setattr(channel, role, ws)
    if role == "phone" and channel.desktop is not None:
        await _safe_send(channel.desktop, {"type": "status", "phoneConnected": True})
    return channel


async def leave(session_id: str | None, role: str, ws: WebSocket) -> None:
    sid = normalize_session_id(session_id)
    channel = _channels.get(sid)
    if channel is None or getattr(channel, role) is not ws:
        return
    setattr(channel, role, None)
    if role == "phone" and channel.desktop is not None:
        await _safe_send(channel.desktop, {"type": "status", "phoneConnected": False})
    if channel.desktop is None and channel.phone is None:
        _channels.pop(sid, None)


async def relay_from_phone(session_id: str | None, message: dict) -> None:
    channel = _channels.get(normalize_session_id(session_id))
    if channel is not None and channel.desktop is not None:
        await _safe_send(channel.desktop, message)


async def _safe_send(ws: WebSocket, message: dict) -> None:
    try:
        await ws.send_json(message)
    except Exception:
        # The other side's socket is already gone/closing — its own receive
        # loop will hit WebSocketDisconnect and call leave() momentarily.
        pass
