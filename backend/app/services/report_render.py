"""Renders real geometry views and solved-field contour plots for the PDF
report — matplotlib in headless (Agg) mode, no GPU/X11 needed, which is what
makes this reliable inside the Docker container. Geometry comes from the
same tpms.build_lattice marching-cubes extraction the rest of the app uses
(not a separate/fake renderer); contours sample the same real solved fields
foam_field.py already serves to the frontend's solved-field toggle.
"""
from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path
from typing import Literal

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402

from .foam_field import FieldUnavailable, latest_time_dir, read_cell_centres, read_field  # noqa: E402
from .fluid_properties import evaluate_fluid  # noqa: E402
from .solid_properties import evaluate_solid  # noqa: E402

RegionKey = Literal["solid", "hot", "cold"]
FieldName = Literal["temperature", "velocity", "pressure"]

# (elevation, azimuth) camera angles giving a true orthogonal look down each
# axis, plus one isometric — "all 6 faces" of the geometry as requested.
FACE_VIEWS: dict[str, tuple[float, float]] = {
    "+X": (0, 0),
    "-X": (0, 180),
    "+Y": (0, 90),
    "-Y": (0, -90),
    "+Z (top)": (90, -90),
    "-Z (bottom)": (-90, -90),
}
ISO_VIEW = (22, -55)


def _fig_to_data_uri(fig) -> str:
    buf = BytesIO()
    fig.savefig(buf, format="png", dpi=115, bbox_inches="tight", pad_inches=0.05, facecolor="white")
    plt.close(fig)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _bounds(all_positions: list[np.ndarray]) -> tuple[np.ndarray, float]:
    pts = np.concatenate(all_positions, axis=0)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    center = (lo + hi) / 2
    radius = float(np.max(hi - lo)) / 2 * 1.08
    return center, radius


def _new_axes(center: np.ndarray, radius: float, elev: float, azim: float):
    fig = plt.figure(figsize=(4.2, 4.2))
    ax = fig.add_subplot(111, projection="3d")
    ax.set_xlim(center[0] - radius, center[0] + radius)
    ax.set_ylim(center[1] - radius, center[1] + radius)
    ax.set_zlim(center[2] - radius, center[2] + radius)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=elev, azim=azim)
    ax.set_axis_off()
    return fig, ax


def render_geometry_views(regions: dict[str, dict]) -> dict[str, str]:
    """regions: {name: {"positions": (N,3) mm ndarray, "indices": (M,3) ndarray,
    "color": "#rrggbb", "alpha": float}}. Returns {view_name: data-uri PNG},
    one per FACE_VIEWS entry plus "ISO"."""
    center, radius = _bounds([r["positions"] for r in regions.values()])
    out: dict[str, str] = {}

    for name, (elev, azim) in {**FACE_VIEWS, "ISO (isometric)": ISO_VIEW}.items():
        fig, ax = _new_axes(center, radius, elev, azim)
        for r in regions.values():
            tri = r["positions"][r["indices"]]
            coll = Poly3DCollection(tri, facecolor=r["color"], edgecolor="none", alpha=r["alpha"])
            ax.add_collection3d(coll)
        out[name] = _fig_to_data_uri(fig)
    return out


def render_contour(
    case_dir: Path,
    region: RegionKey,
    field: FieldName,
    positions_mm: np.ndarray,
    indices: np.ndarray,
) -> tuple[str, float, float, str]:
    """Colours the given region's real triangulated surface by a genuine
    solved field value at each triangle (nearest OpenFOAM cell centre to
    that triangle's centroid — same nearest-cell-centre approach
    foam_field.sample_field uses for the frontend). Returns
    (data-uri PNG, min, max, solved time). Raises FieldUnavailable exactly
    like foam_field's own sampling does (e.g. U/p in the solid region)."""
    time = latest_time_dir(case_dir)
    values = read_field(case_dir, region, time, field)
    centroids_mm = positions_mm[indices].mean(axis=1)

    if len(values) == 1:
        sampled = np.full(len(centroids_mm), values[0], dtype=np.float64)
    else:
        centres = read_cell_centres(case_dir, region, time)
        if len(centres) != len(values):
            raise FieldUnavailable("cell-centre / field cell-count mismatch — mesh may have changed since the solve")
        from scipy.spatial import cKDTree

        tree = cKDTree(centres)
        _, idx = tree.query(centroids_mm / 1000.0)
        sampled = values[idx]

    if field == "temperature":
        sampled = sampled - 273.15

    lo, hi = float(sampled.min()), float(sampled.max())
    norm = plt.Normalize(vmin=lo, vmax=(hi if hi > lo else lo + 1e-6))
    cmap = plt.get_cmap("turbo")
    colors = cmap(norm(sampled))

    center, radius = _bounds([positions_mm])
    fig, ax = _new_axes(center, radius, *ISO_VIEW)
    tri = positions_mm[indices]
    coll = Poly3DCollection(tri, facecolor=colors, edgecolor="none")
    ax.add_collection3d(coll)

    mappable = plt.cm.ScalarMappable(norm=norm, cmap=cmap)
    mappable.set_array([])
    cbar = fig.colorbar(mappable, ax=ax, shrink=0.55, pad=0.02)
    cbar.ax.tick_params(labelsize=7)

    return _fig_to_data_uri(fig), lo, hi, time


def render_fluid_property_plot(fluid: str, pressure_pa: float, t_center: float, color: str) -> str | None:
    """ρ/μ/cₚ/k vs T at the stream's actual operating pressure, swept ±60°C
    around its inlet temperature — genuinely re-evaluated per point (real
    CoolProp when available), not a fabricated smooth curve. Returns None if
    every point in the window fails (e.g. a custom-saved fluid — snapshot
    values only, no equation of state to sweep) so the caller can omit the
    figure rather than show an empty/misleading plot."""
    ts = np.linspace(t_center - 60, t_center + 60, 25)
    rows = []
    for t in ts:
        state = evaluate_fluid(fluid, float(t), pressure_pa)
        if state is not None:
            rows.append((t, state["rho"], state["mu"], state["cp"], state["k"]))
    if len(rows) < 2:
        return None

    arr = np.array(rows)
    fig, axes = plt.subplots(1, 4, figsize=(9.6, 2.2))
    specs = [("ρ  [kg/m³]", 1), ("μ  [Pa·s]", 2), ("cₚ  [J/kg·K]", 3), ("k  [W/m·K]", 4)]
    for ax, (label, col) in zip(axes, specs):
        ax.plot(arr[:, 0], arr[:, col], color=color, linewidth=1.3)
        ax.axvline(t_center, color="#888", linestyle="--", linewidth=0.7)
        ax.set_title(label, fontsize=8)
        ax.set_xlabel("T [°C]", fontsize=7)
        ax.tick_params(labelsize=6.5)
        ax.grid(alpha=0.25)
    fig.tight_layout()
    return _fig_to_data_uri(fig)


def render_solid_property_plot(mat: str) -> str | None:
    """k/cₚ vs T for one of the 5 built-in alloys (see solid_properties.py) —
    None for a custom/unrecognised material, since there's no table to sweep."""
    if evaluate_solid(mat, 20) is None:
        return None
    ts = np.linspace(20, 600, 30)
    rows = [(t, *evaluate_solid(mat, float(t))) for t in ts]
    arr = np.array(rows)

    fig, axes = plt.subplots(1, 2, figsize=(6.0, 2.2))
    for ax, (label, col) in zip(axes, [("k  [W/m·K]", 1), ("cₚ  [J/kg·K]", 2)]):
        ax.plot(arr[:, 0], arr[:, col], color="#8a93a0", linewidth=1.3)
        ax.set_title(label, fontsize=8)
        ax.set_xlabel("T [°C]", fontsize=7)
        ax.tick_params(labelsize=6.5)
        ax.grid(alpha=0.25)
    fig.tight_layout()
    return _fig_to_data_uri(fig)


_RESIDUAL_COLOUR = {"ux": "#e2603f", "p": "#5ec8c0", "hHot": "#4aa8d8", "hCold": "#7fb98b", "hSolid": "#c9a24a"}


def render_residual_chart(residuals: dict[str, list[float]], target: float) -> str:
    """Same real per-iteration residual history the live app's ResidualChart
    shows (not re-derived), just rendered to a static image for the PDF."""
    fig, ax = plt.subplots(figsize=(6.4, 2.6))
    for key, values in residuals.items():
        if not values:
            continue
        ax.plot(range(len(values)), values, label=key, color=_RESIDUAL_COLOUR.get(key, "#888"), linewidth=1.1)
    ax.axhline(target, color="#5ec8c0", linestyle="--", linewidth=0.9, alpha=0.6)
    ax.set_yscale("log")
    ax.set_xlabel("iteration", fontsize=8)
    ax.set_ylabel("residual (log)", fontsize=8)
    ax.tick_params(labelsize=7)
    ax.legend(fontsize=7, ncol=5, loc="upper right", frameon=False)
    ax.grid(alpha=0.2)
    fig.tight_layout()
    return _fig_to_data_uri(fig)
