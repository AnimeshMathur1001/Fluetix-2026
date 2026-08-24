"""Derives genuine, solved-field-based performance metrics — not the
closed-form epsilon-NTU model in physics.py — by reading OpenFOAM's own
boundary-patch `value` entries at the latest solved time. That `value` entry
is the field's actual computed face state at write time (for a `fixedValue`
patch it's the prescribed value; for `inletOutlet`/coupled patches it's
whatever the solver actually converged to there), not a re-derivation, so
averaging it over an inlet/outlet patch is a genuine solved result.

Used by both the mesh-independence study and the PDF report so both draw on
the same real numbers, computed once.

Disclosed simplification: patch averages here are a plain arithmetic mean of
the boundary faces' values, not area-weighted. Getting true area weighting
would need each patch's per-face area (an extra `postProcess` pass per
patch); for the fairly uniform face sizes snappyHexMesh produces here the
difference is small, but this is a real approximation, not hidden.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import numpy as np

from .foam_case import PATCH_NAME
from .foam_field import FieldUnavailable, latest_time_dir, read_field

RegionKey = Literal["solid", "hot", "cold"]
FieldName = Literal["temperature", "velocity", "pressure"]

_FIELD_FILE = {"temperature": "T", "velocity": "U", "pressure": "p"}

# Deliberately matches "value" but not "refValue"/"inletValue" — those are a
# mixed BC's own reference constants, not the face's actual solved state.
_PATCH_VALUE_LIST_RE = re.compile(r"(?<![a-zA-Z])value\s+nonuniform\s+List<(scalar|vector)>\s*(\d+)\s*\(")
_PATCH_VALUE_UNIFORM_RE = re.compile(r"(?<![a-zA-Z])value\s+uniform\s+([^;]+);")


def _extract_patch_block(text: str, patch_name: str) -> str:
    m = re.search(r"\n\s*" + re.escape(patch_name) + r"\s*\n\s*\{", text)
    if not m:
        raise FieldUnavailable(f"patch {patch_name!r} not present in this field's boundaryField")
    start = m.end() - 1
    depth, i = 0, start
    while i < len(text):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return text[start + 1 : i]
        i += 1
    raise FieldUnavailable(f"unterminated boundaryField block for {patch_name!r}")


def _parse_list_after(text: str, open_paren: int, kind: str, n: int) -> np.ndarray:
    if kind == "scalar":
        end = text.index(")", open_paren)
        vals: list = [float(x) for x in text[open_paren + 1 : end].split()]
    else:
        i = open_paren + 1
        vals = []
        for _ in range(n):
            i = text.index("(", i)
            j = text.index(")", i)
            vals.append([float(v) for v in text[i + 1 : j].split()])
            i = j + 1
    arr = np.array(vals, dtype=np.float64)
    if len(arr) != n:
        raise FieldUnavailable(f"expected {n} boundary values, found {len(arr)}")
    return arr


def patch_average(case_dir: Path, region: RegionKey, field: FieldName, patch_name: str, time: str | None = None) -> float:
    """Arithmetic mean of a patch's real solved boundary 'value' entries."""
    time = time or latest_time_dir(case_dir)
    path = case_dir / time / region / _FIELD_FILE[field]
    if not path.exists():
        raise FieldUnavailable(f"{path} not found – was this region actually solved?")
    block = _extract_patch_block(path.read_text(), patch_name)

    m = _PATCH_VALUE_LIST_RE.search(block)
    if m:
        kind, n = m.group(1), int(m.group(2))
        arr = _parse_list_after(block, m.end() - 1, kind, n)
    else:
        um = _PATCH_VALUE_UNIFORM_RE.search(block)
        if not um:
            raise FieldUnavailable(f"no 'value' entry found for patch {patch_name!r}")
        raw = um.group(1).strip()
        arr = np.array([[float(v) for v in raw.strip("()").split()]] if "(" in raw else [float(raw)], dtype=np.float64)

    if arr.ndim == 2:
        arr = np.linalg.norm(arr, axis=1)
    return float(arr.mean())


def solved_performance(
    case_dir: Path,
    faces: dict[str, str],
    hot: dict,
    cold: dict,
) -> dict:
    """Real, solved-field-derived counterpart to physics.compute_performance —
    inlet/outlet averages, pressure drop, heat duty and effectiveness computed
    from the actual chtMultiRegionSimpleFoam result, not a correlation."""
    time = latest_time_dir(case_dir)

    def endpoint(role_in: str, role_out: str, region: RegionKey) -> dict:
        patch_in = next(PATCH_NAME[k] for k, r in faces.items() if r == role_in)
        patch_out = next(PATCH_NAME[k] for k, r in faces.items() if r == role_out)
        t_in = patch_average(case_dir, region, "temperature", patch_in, time)
        t_out = patch_average(case_dir, region, "temperature", patch_out, time)
        p_in = patch_average(case_dir, region, "pressure", patch_in, time)
        p_out = patch_average(case_dir, region, "pressure", patch_out, time)
        u_in = patch_average(case_dir, region, "velocity", patch_in, time)
        u_out = patch_average(case_dir, region, "velocity", patch_out, time)
        return {
            "TinC": t_in - 273.15,
            "ToutC": t_out - 273.15,
            "pIn": p_in,
            "pOut": p_out,
            "pressureDrop": p_in - p_out,
            "velocityIn": u_in,
            "velocityOut": u_out,
        }

    hot_perf = endpoint("inletHot", "outletHot", "hot")
    cold_perf = endpoint("inletCold", "outletCold", "cold")

    c_hot = hot["mdot"] * hot["cp"]
    c_cold = cold["mdot"] * cold["cp"]
    q_hot = c_hot * (hot_perf["TinC"] - hot_perf["ToutC"])
    q_cold = c_cold * (cold_perf["ToutC"] - cold_perf["TinC"])
    q_avg = (q_hot + q_cold) / 2
    imbalance = abs(q_hot - q_cold) / q_avg * 100 if q_avg else 0.0

    c_min = min(c_hot, c_cold)
    q_max = c_min * (hot_perf["TinC"] - cold_perf["TinC"])
    effectiveness = q_avg / q_max if q_max else 0.0

    solid_t = read_field(case_dir, "solid", time, "temperature")

    return {
        "time": time,
        "hot": hot_perf,
        "cold": cold_perf,
        "Qhot": q_hot,
        "Qcold": q_cold,
        "Q": q_avg,
        "imbalance": imbalance,
        "effectiveness": effectiveness,
        "solidTminC": float(solid_t.min()) - 273.15,
        "solidTmaxC": float(solid_t.max()) - 273.15,
    }
