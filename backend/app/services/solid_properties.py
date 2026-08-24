"""Python port of src/lib/solidProperties.ts's k(T)/cp(T) breakpoint tables —
kept in sync by hand (small, rarely-changed data); used server-side only for
the PDF report's property-vs-temperature plots. See the frontend file for the
full provenance note: these are literature/datasheet-typical values for the
5 built-in AM alloys, not a certified per-batch spec.
"""
from __future__ import annotations

import math

TABLES: dict[str, list[tuple[float, float, float]]] = {
    # (temperature degC, k W/m.K, cp J/kg.K)
    "alsi10mg": [(20, 120, 900), (100, 130, 940), (200, 143, 990), (300, 155, 1040)],
    "ti64": [(20, 6.7, 560), (200, 8.8, 610), (400, 11.5, 650), (600, 14.5, 680)],
    "ss316": [(20, 15.0, 500), (200, 17.5, 540), (400, 20.0, 565), (600, 22.5, 590)],
    "cucrzr": [(20, 320, 390), (200, 330, 400), (400, 325, 415), (600, 310, 430)],
    "in718": [(20, 11.4, 435), (200, 13.0, 480), (400, 15.8, 520), (600, 19.6, 555), (800, 23.3, 600)],
}


def is_solid_correlated(mat: str) -> bool:
    return mat in TABLES


def evaluate_solid(mat: str, temp_c: float) -> tuple[float, float] | None:
    """Returns (k, cp) piecewise-linearly interpolated, clamped at the table's endpoints."""
    table = TABLES.get(mat)
    if not table:
        return None
    if temp_c <= table[0][0]:
        return table[0][1], table[0][2]
    if temp_c >= table[-1][0]:
        return table[-1][1], table[-1][2]
    for (t0, k0, cp0), (t1, k1, cp1) in zip(table, table[1:]):
        if temp_c <= t1:
            f = (temp_c - t0) / (t1 - t0)
            return k0 + f * (k1 - k0), cp0 + f * (cp1 - cp0)
    return table[-1][1], table[-1][2]


YIELD_STRENGTH_MPa: dict[str, float] = {
    "alsi10mg": 230.0,
    "ti64":    1000.0,
    "ss316":    450.0,
    "cucrzr":   300.0,
    "in718":   1000.0,
}

_BURST_SF = 2.0


def tpms_min_curvature_radius(
    surface: str,
    cell_size_mm: float,
) -> float:
    """Approximate minimum principal curvature radius of a
    TPMS surface at the given unit-cell size.

    For the gyroid: R_min ~ a / (2 pi).
    For Schwarz-P:  R_min ~ a / (2 pi * 0.9).
    For Diamond:    R_min ~ a / (2 pi * 0.8).
    For IWP:        R_min ~ a / (2 pi * 1.2).
    """
    factors = {
        "gyroid":  2 * math.pi,
        "schwarzp": 2 * math.pi * 0.9,
        "diamond":  2 * math.pi * 0.8,
        "iwp":      2 * math.pi * 1.2,
    }
    denom = factors.get(surface, 2 * math.pi)
    return cell_size_mm / denom


def estimate_burst_pressure(
    mat: str,
    surface: str,
    cell_size_mm: float,
    thickness_mm: float,
) -> dict | None:
    """Thin-shell burst pressure estimate for a TPMS wall.

    Uses the Laplace pressure relation for a curved membrane:
        P = 2 * sigma_y * t / (R_min * SF)

    Returns None when the material is not in the database.
    Result is a screening estimate for early-stage design.
    Always verify with FEA before fabrication.
    """
    sigma_y = YIELD_STRENGTH_MPa.get(mat)
    if sigma_y is None or thickness_mm <= 0:
        return None

    r_min = tpms_min_curvature_radius(surface, cell_size_mm)
    if r_min <= 0:
        return None

    sigma_Pa = sigma_y * 1e6
    t_m      = thickness_mm / 1000.0
    r_m      = r_min / 1000.0
    p_Pa     = (2.0 * sigma_Pa * t_m) / (r_m * _BURST_SF)

    return {
        "mat":             mat,
        "yieldMPa":        sigma_y,
        "safetyFactor":    _BURST_SF,
        "thicknessMm":     thickness_mm,
        "rMinMm":          round(r_min, 4),
        "burstPa":         p_Pa,
        "burstBar":        p_Pa / 1e5,
        "burstMPa":        p_Pa / 1e6,
    }
