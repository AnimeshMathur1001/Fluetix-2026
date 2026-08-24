"""WS /design-explorer — a multi-objective design sweep over wall thickness
and overall unit-cell scale, ending in a real Pareto front: every point that
gets ranked "non-dominated" was actually meshed and solved
(chtMultiRegionSimpleFoam), not just predicted.

Two-stage pipeline:
1. Build a candidate pool on a deterministic grid across the requested
   thickness/cell-scale ranges. Each candidate's solid fraction is computed
   for real (services/tpms.build_lattice at preview resolution — the same
   function POST /geometry/lattice uses, just cheaper voxel count, disclosed
   as such) — this is a genuine geometry number, just a coarser one than the
   final mesh will use. If services/surrogate.py has enough real history for
   this surface type, every pool candidate also gets a *predicted*
   effectiveness/pressure-drop from it, and the pool is ranked by predicted
   Pareto-dominance to pick which `sampleCount` candidates are worth actually
   solving. Without enough history, pre-screening is skipped and the sample
   is spread evenly across the pool instead — disclosed to the client via
   `screened: false` rather than silently degrading.
2. Only the selected `sampleCount` candidates get a real mesh + solve
   (sequentially, through the same shared job queue as everything else) —
   the final Pareto front the client sees is computed from real solved
   results, never from the pre-screening predictions.

Client sends one JSON config message to start:
    {"thicknessRange": [min, max], "cellScaleRange": [min, max],
     "sampleCount": int, "bgCells", "maxIterations", "residualTarget",
     "surface", "cellX", "cellY", "cellZ", "grading", "gradAxis",
     "nx", "ny", "nz", "faces", "hot", "cold", "solid"}
Server streams:
    {"phase": "pool", "poolSize": int, "screened": bool}
    {"phase": "candidate_meshing", "index": int, "total": int, "thickness": float, "cellScale": float}
    {"phase": "candidate_meshed", "index": int, "cells": int, "hot": int, "cold": int, "solid": int}
    {"phase": "candidate_solving", "index": int, "iteration": int, "residuals": {...}, "converged": bool|null}
    {"phase": "candidate_done", "index": int, "thickness": float, "cellScale": float,
     "solidFraction": float, "performance": {...solved_performance...}}
    {"phase": "failed", "index": int|None, "error": str}
    {"phase": "complete", "candidates": [...candidate_done payloads, "paretoFront": bool...], "screened": bool}
"""
from __future__ import annotations

import math
import shutil

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..services import design_history, job_state, surrogate
from ..services.foam_case import MeshPipelineError, generate_case, run_mesh_pipeline
from ..services.foam_field import FieldUnavailable
from ..services.foam_metrics import solved_performance
from ..services.foam_solve import run_real_solve
from ..services.queue import mesh_queue
from ..services.tpms import HAVE_SKIMAGE, build_lattice

router = APIRouter(tags=["explorer"])

MAX_SAMPLE_COUNT = 10
_PREVIEW_VOXELS_PER_CELL = 16


def _avg_pressure_drop(performance: dict) -> float:
    return (performance["hot"]["pressureDrop"] + performance["cold"]["pressureDrop"]) / 2


def _dominates(a: dict, b: dict) -> bool:
    """a dominates b: at least as good on every objective, strictly better on
    one. Objectives: maximize effectiveness, minimize pressure drop, minimize
    solid fraction (a real proxy for print mass/cost, not the full overhang
    manufacturability check — that needs the client's own triangle mesh)."""
    better_or_equal = (
        a["effectiveness"] >= b["effectiveness"]
        and a["pressureDrop"] <= b["pressureDrop"]
        and (a["solidFraction"] is None or b["solidFraction"] is None or a["solidFraction"] <= b["solidFraction"])
    )
    strictly_better = (
        a["effectiveness"] > b["effectiveness"]
        or a["pressureDrop"] < b["pressureDrop"]
        or (a["solidFraction"] is not None and b["solidFraction"] is not None and a["solidFraction"] < b["solidFraction"])
    )
    return better_or_equal and strictly_better


def _pareto_front(objectives: list[dict]) -> list[bool]:
    return [not any(_dominates(other, obj) for j, other in enumerate(objectives) if j != i) for i, obj in enumerate(objectives)]


def _build_pool(surface: str, base_cell: tuple[float, float, float], grading: float, grad_axis: str,
                 thickness_range: tuple[float, float], scale_range: tuple[float, float], pool_side: int) -> list[dict]:
    t_lo, t_hi = thickness_range
    s_lo, s_hi = scale_range
    pool = []
    for i in range(pool_side):
        for j in range(pool_side):
            frac_t = i / (pool_side - 1) if pool_side > 1 else 0.0
            frac_s = j / (pool_side - 1) if pool_side > 1 else 0.0
            thickness = t_lo + frac_t * (t_hi - t_lo)
            scale = s_lo + frac_s * (s_hi - s_lo)
            cell = (base_cell[0] * scale, base_cell[1] * scale, base_cell[2] * scale)
            solid_fraction = None
            if HAVE_SKIMAGE:
                try:
                    geo = build_lattice(
                        surface=surface, cell=cell, thickness=thickness, grading=grading, grad_axis=grad_axis,
                        n=(1, 1, 1), region="solid", voxels_per_cell=_PREVIEW_VOXELS_PER_CELL,
                    )
                    solid_fraction = geo["solidFraction"]
                except Exception:
                    solid_fraction = None
            pool.append({"thickness": thickness, "cellScale": scale, "cell": cell, "solidFraction": solid_fraction})
    return pool


def _select_candidates(pool: list[dict], surface: str, sample_count: int, base_hot: dict, base_cold: dict, base_solid: dict) -> tuple[list[dict], bool]:
    scored = []
    for p in pool:
        params = design_history.build_params(
            cellX=p["cell"][0], cellY=p["cell"][1], cellZ=p["cell"][2],
            thickness=p["thickness"], grading=0.0, hot=base_hot, cold=base_cold, solid=base_solid,
        )
        est = surrogate.estimate(surface, params)
        scored.append(est)

    have_predictions = any(e is not None for e in scored)
    if not have_predictions:
        # Not enough real history to pre-screen yet — spread the sample
        # evenly across the pool instead of guessing.
        step = max(1, len(pool) // sample_count)
        return pool[::step][:sample_count], False

    objectives = [
        {
            "effectiveness": scored[i]["effectiveness"] if scored[i] else -math.inf,
            "pressureDrop": (scored[i]["pressureDropHot"] + scored[i]["pressureDropCold"]) / 2 if scored[i] else math.inf,
            "solidFraction": pool[i]["solidFraction"],
        }
        for i in range(len(pool))
    ]
    front_flags = _pareto_front(objectives)
    front_indices = [i for i, on_front in enumerate(front_flags) if on_front]
    front_indices.sort(key=lambda i: objectives[i]["effectiveness"], reverse=True)

    if len(front_indices) >= sample_count:
        step = max(1, len(front_indices) // sample_count)
        chosen = front_indices[::step][:sample_count]
    else:
        remaining = [i for i in range(len(pool)) if i not in front_indices]
        remaining.sort(key=lambda i: objectives[i]["effectiveness"], reverse=True)
        chosen = front_indices + remaining[: sample_count - len(front_indices)]

    return [pool[i] for i in chosen], True


@router.websocket("/design-explorer")
async def design_explorer(ws: WebSocket) -> None:
    await ws.accept()
    try:
        config = await ws.receive_json()
        thickness_range = tuple(float(v) for v in config["thicknessRange"])
        scale_range = tuple(float(v) for v in config["cellScaleRange"])
        sample_count = min(MAX_SAMPLE_COUNT, max(1, int(config["sampleCount"])))
        bg_cells = int(config["bgCells"])
        max_iterations = int(config.get("maxIterations", 2000))
        target = float(config.get("residualTarget", 1e-4))
        surface = config["surface"]
        base_cell = (float(config["cellX"]), float(config["cellY"]), float(config["cellZ"]))
        grading, grad_axis = config["grading"], config["gradAxis"]
        faces = config["faces"]
        hot, cold, solid = config["hot"], config["cold"], config["solid"]

        pool_side = max(4, min(7, sample_count * 2))
        pool = _build_pool(surface, base_cell, grading, grad_axis, thickness_range, scale_range, pool_side)
        candidates, screened = _select_candidates(pool, surface, sample_count, hot, cold, solid)

        await ws.send_json({"phase": "pool", "poolSize": len(pool), "screened": screened})

        state = job_state.get_session(ws.query_params.get("session"))
        if not state.mesh_lock.acquire(blocking=False):
            await ws.send_json({"phase": "failed", "index": None, "error": "A mesh generation is already running for this case – wait for it to finish."})
            return

        completed: list[dict] = []
        try:
            for index, cand in enumerate(candidates):
                cand_dir = state.case_dir / f"explore-{index}"
                await ws.send_json({"phase": "candidate_meshing", "index": index, "total": len(candidates), "thickness": cand["thickness"], "cellScale": cand["cellScale"]})

                async with mesh_queue.slot(ws.send_json):
                    if cand_dir.exists():
                        shutil.rmtree(cand_dir)
                    try:
                        generate_case(
                            case_dir=cand_dir,
                            surface=surface,
                            cell=cand["cell"],
                            n=(config["nx"], config["ny"], config["nz"]),
                            thickness=cand["thickness"],
                            grading=grading,
                            grad_axis=grad_axis,
                            faces=faces,
                            hot=hot,
                            cold=cold,
                            solid=solid,
                            bg_cells=bg_cells,
                            stl_voxels=48,
                            max_iterations=1,
                        )
                        mesh_stats = run_mesh_pipeline(cand_dir)
                    except MeshPipelineError as exc:
                        await ws.send_json({"phase": "failed", "index": index, "error": f"{exc.step} failed – see server logs"})
                        continue

                    await ws.send_json({"phase": "candidate_meshed", "index": index, **mesh_stats})

                    async for msg in run_real_solve(cand_dir, max_iterations, target):
                        await ws.send_json({"phase": "candidate_solving", "index": index, **msg})

                    try:
                        performance = solved_performance(cand_dir, faces, hot, cold)
                    except FieldUnavailable as exc:
                        await ws.send_json({"phase": "failed", "index": index, "error": str(exc)})
                        continue

                params = design_history.build_params(
                    cellX=cand["cell"][0], cellY=cand["cell"][1], cellZ=cand["cell"][2],
                    thickness=cand["thickness"], grading=grading, hot=hot, cold=cold, solid=solid,
                )
                design_history.record(surface, params, performance, origin="explorer")

                result = {
                    "index": index, "thickness": cand["thickness"], "cellScale": cand["cellScale"],
                    "solidFraction": cand["solidFraction"], "performance": performance,
                }
                completed.append(result)
                await ws.send_json({"phase": "candidate_done", **result})

            if completed:
                real_objectives = [
                    {"effectiveness": c["performance"]["effectiveness"], "pressureDrop": _avg_pressure_drop(c["performance"]), "solidFraction": c["solidFraction"]}
                    for c in completed
                ]
                on_front = _pareto_front(real_objectives)
                for c, front in zip(completed, on_front):
                    c["paretoFront"] = front

                state.active_case_dir = state.case_dir / f"explore-{completed[-1]['index']}"
                state.last_mesh_key = None

            await ws.send_json({"phase": "complete", "candidates": completed, "screened": screened})
        finally:
            state.mesh_lock.release()
    except WebSocketDisconnect:
        return
