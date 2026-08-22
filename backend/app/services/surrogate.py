"""Instant performance estimate from previously solved cases — a
distance-weighted nearest-neighbour regression over services/design_history.py's
log, not a physics simulation and not a pretrained model shipped with the
app. Every point it draws on is a real chtMultiRegionSimpleFoam result from
this server's own history, so the estimate genuinely gets more accurate (and
more available) the more real cases get solved here — that's the entire
mechanism, no black box beyond "average your nearest real neighbours".

Deliberately hand-rolled on top of numpy (already a hard dependency) rather
than adding a machine-learning library: k-NN regression is transparent
enough to disclose exactly how a number was produced, and this app already
refuses to show a number it can't explain (see foam_metrics.py's own
disclosed-simplification precedent).
"""
from __future__ import annotations

from typing import Any

import numpy as np

from . import design_history

# The subset of case params that actually determine a CHT solve's outcome
# and that every candidate (quick estimate, uncertainty variant, explorer
# point) always has — order fixes the feature-vector axis order below.
_FEATURES = [
    ("cellX", lambda p: p["cellX"]),
    ("cellY", lambda p: p["cellY"]),
    ("cellZ", lambda p: p["cellZ"]),
    ("thickness", lambda p: p["thickness"]),
    ("grading", lambda p: p["grading"]),
    ("hotMdot", lambda p: p["hot"]["mdot"]),
    ("hotTin", lambda p: p["hot"]["Tin"]),
    ("coldMdot", lambda p: p["cold"]["mdot"]),
    ("coldTin", lambda p: p["cold"]["Tin"]),
    ("solidK", lambda p: p["solid"]["k"]),
]

MIN_RECORDS = 3
_K_NEIGHBOURS = 5


def _vector(params: dict[str, Any]) -> np.ndarray:
    return np.array([fn(params) for _, fn in _FEATURES], dtype=np.float64)


def estimate(surface: str, params: dict[str, Any]) -> dict[str, Any] | None:
    """Returns None if there isn't enough real history for this surface type
    yet (callers should show that honestly, not a number). Otherwise:
    {"effectiveness", "pressureDropHot", "pressureDropCold", "Q", "confidence"
    (0-1), "basedOn": neighbour count actually used, "sampleSize": total
    records available for this surface}."""
    records = design_history.for_surface(surface)
    if len(records) < MIN_RECORDS:
        return None

    matrix = np.stack([_vector(r["params"]) for r in records])
    query = _vector(params)

    # z-score both the history and the query in the history's own units so no
    # single axis (e.g. mdot in kg/s vs Tin in K) dominates the distance just
    # because its raw numbers are bigger. A zero-variance axis (every
    # historical record used the same value) is dropped from the distance
    # entirely rather than divided by zero.
    mean = matrix.mean(axis=0)
    std = matrix.std(axis=0)
    active = std > 1e-9
    if not active.any():
        norm_matrix = np.zeros((len(records), 0))
        norm_query = np.zeros(0)
    else:
        norm_matrix = (matrix[:, active] - mean[active]) / std[active]
        norm_query = (query[active] - mean[active]) / std[active]

    distances = np.linalg.norm(norm_matrix - norm_query, axis=1)
    k = min(_K_NEIGHBOURS, len(records))
    nearest_idx = np.argsort(distances)[:k]
    nearest_dist = distances[nearest_idx]

    weights = 1.0 / (nearest_dist + 1e-6)
    weights = weights / weights.sum()

    def weighted(path: tuple[str, ...]) -> float:
        values = []
        for i in nearest_idx:
            v: Any = records[i]["performance"]
            for key in path:
                v = v[key]
            values.append(float(v))
        return float(np.dot(weights, np.array(values)))

    # Confidence collapses two honest signals into one 0-1 number: how close
    # the nearest real case actually is (in normalized parameter space) and
    # how many real cases back the estimate at all. Neither alone is enough —
    # 1 suspiciously-close neighbour and 50 distant ones are both weak
    # evidence for different reasons.
    closeness = float(np.exp(-nearest_dist.mean() / 2.0))
    coverage = min(1.0, len(records) / 15.0)
    confidence = round(0.5 * closeness + 0.5 * coverage, 3)

    return {
        "effectiveness": weighted(("effectiveness",)),
        "pressureDropHot": weighted(("hot", "pressureDrop")),
        "pressureDropCold": weighted(("cold", "pressureDrop")),
        "Q": weighted(("Q",)),
        "confidence": confidence,
        "basedOn": int(k),
        "sampleSize": len(records),
    }
