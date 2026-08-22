"""Append-only log of every real solved case this server has produced —
the training set behind services/surrogate.py's quick-estimate feature.

Each record pairs the inputs that actually determine a CHT solve's outcome
(geometry + both streams' fluid state + the solid) with
foam_metrics.solved_performance's real output for that case. Nothing here is
synthesized: a record only exists because run_real_solve actually converged
(or ran out of iterations) on a real generate_case + run_mesh_pipeline case
directory — see the three call sites in routers/solve.py, mesh_independence.py,
and uncertainty.py.

Persisted as JSON Lines under app/data/ (not the per-session tempdir
job_state.py uses for case files) so it survives a session/case eviction and
a container restart if that directory is volume-mounted — see docker-compose.yml.
Kept entirely in memory otherwise; this is a small, slow-growing log (one
line per completed solve), not a database.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
HISTORY_FILE = DATA_DIR / "design_history.jsonl"

_lock = threading.Lock()
_records: list[dict[str, Any]] | None = None


def _load_locked() -> list[dict[str, Any]]:
    if not HISTORY_FILE.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in HISTORY_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except ValueError:
            continue  # a truncated last line from a killed process — skip, don't crash
    return records


def _ensure_loaded() -> list[dict[str, Any]]:
    global _records
    if _records is None:
        _records = _load_locked()
    return _records


def build_params(*, cellX: float, cellY: float, cellZ: float, thickness: float, grading: float, hot: dict, cold: dict, solid: dict) -> dict[str, Any]:
    """One shared shape for the subset of case config every call site
    (routers/solve.py, mesh_independence.py, uncertainty.py, explorer.py) logs
    against — must match the keys services/surrogate.py's feature vector
    reads, so it's built in one place rather than duplicated at each site."""
    return {
        "cellX": cellX, "cellY": cellY, "cellZ": cellZ,
        "thickness": thickness, "grading": grading,
        "hot": {"mdot": hot["mdot"], "Tin": hot["Tin"]},
        "cold": {"mdot": cold["mdot"], "Tin": cold["Tin"]},
        "solid": {"k": solid["k"]},
    }


def record(surface: str, params: dict[str, Any], performance: dict[str, Any], origin: str) -> None:
    """Appends one real solved case. `params` carries exactly the inputs
    surrogate.py's feature vector reads (geometry + hot/cold/solid); `origin`
    is a short label for which pipeline produced it (e.g. "solve",
    "mesh-independence", "uncertainty", "explorer") — not shown to users,
    just useful for a future audit of where the training data came from."""
    entry = {
        "id": uuid.uuid4().hex,
        "timestamp": time.time(),
        "surface": surface,
        "origin": origin,
        "params": params,
        "performance": performance,
    }
    with _lock:
        records = _ensure_loaded()
        records.append(entry)
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        with HISTORY_FILE.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")


def for_surface(surface: str) -> list[dict[str, Any]]:
    with _lock:
        return [r for r in _ensure_loaded() if r["surface"] == surface]


def stats() -> dict[str, Any]:
    with _lock:
        records = _ensure_loaded()
    counts: dict[str, int] = {}
    for r in records:
        counts[r["surface"]] = counts.get(r["surface"], 0) + 1
    return {"total": len(records), "bySurface": counts}
