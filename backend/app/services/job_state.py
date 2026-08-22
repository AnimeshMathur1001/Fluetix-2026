"""Per-session case-directory registry, shared between /mesh, WS /solve,
WS /mesh-independence and /report. Each browser session gets its own
isolated case directory (and its own mesh lock/cache), identified by a
session id the frontend generates once (see src/lib/session.ts) and sends
on every request as `?session=` — this is what actually lets two different
people use the same running backend without racing or silently overwriting
each other's case. Callers that omit the id fall back to a fixed shared
session, so older API clients keep working exactly as before this existed."""
from __future__ import annotations

import re
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(tempfile.gettempdir()) / "heat-exchanger-analyser-cases"

# Soft cap appropriate for a small single-VM deployment shared by a handful
# of people at once — not a hard multi-tenant quota system. See
# evict_stale_sessions() for what actually enforces this.
MAX_SESSIONS = 12
SESSION_TTL_SECONDS = 2 * 60 * 60  # evict a session's case dir 2h after its last request

_SESSION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_DEFAULT_SESSION = "default"


@dataclass
class SessionState:
    case_dir: Path
    active_case_dir: Path | None = None
    # Guards this session's case_dir from two of ITS OWN requests racing each
    # other (e.g. a double-click) — see mesh_lock usage in routers/mesh.py.
    mesh_lock: threading.Lock = field(default_factory=threading.Lock)
    last_mesh_key: str | None = None
    last_mesh_stats: dict | None = None
    last_touched: float = field(default_factory=time.time)


_sessions: dict[str, SessionState] = {}
_registry_lock = threading.Lock()


def normalize_session_id(session_id: str | None) -> str:
    if session_id and _SESSION_ID_RE.match(session_id):
        return session_id
    return _DEFAULT_SESSION


def get_session(session_id: str | None) -> SessionState:
    """Returns this session's state, creating it (and its case dir path,
    not yet the directory itself — that happens on first real mesh) on
    first use. Also opportunistically evicts old sessions so the registry
    and on-disk case dirs don't grow without bound."""
    sid = normalize_session_id(session_id)
    with _registry_lock:
        state = _sessions.get(sid)
        if state is None:
            state = SessionState(case_dir=BASE_DIR / sid)
            _sessions[sid] = state
            _evict_stale_locked()
        state.last_touched = time.time()
        return state


def _evict_stale_locked() -> None:
    """Removes on-disk case directories for sessions that are either past
    SESSION_TTL_SECONDS since their last request, or past MAX_SESSIONS when
    ranked oldest-first — skips any session whose mesh_lock is currently
    held so an active job's case dir is never pulled out from under it."""
    now = time.time()
    idle = [(sid, s) for sid, s in _sessions.items() if not s.mesh_lock.locked()]

    stale = {sid for sid, s in idle if now - s.last_touched > SESSION_TTL_SECONDS}
    overflow: set[str] = set()
    if len(_sessions) > MAX_SESSIONS:
        by_age = sorted(idle, key=lambda kv: kv[1].last_touched)
        overflow = {sid for sid, _ in by_age[: max(0, len(_sessions) - MAX_SESSIONS)]}

    for sid in stale | overflow:
        state = _sessions.pop(sid, None)
        if state and state.case_dir.exists():
            shutil.rmtree(state.case_dir, ignore_errors=True)


def session_count() -> int:
    return len(_sessions)
